"""
Payment Compliance Detection System - Production Ready
Features:
- Rules Library (persistent storage of extracted rules)
- Message Queue processing for high-volume payments
- Batch validation
- Rule versioning
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import json
import re
from datetime import datetime
import xml.etree.ElementTree as ET
import os
from openai import OpenAI
import PyPDF2
import io
import asyncio
from collections import deque
import dotenv
dotenv.load_dotenv()

app = FastAPI(title="Payment Compliance API - Production", version="4.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize AI Client
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "your-api-key-here")
USE_AI = OPENAI_API_KEY and OPENAI_API_KEY != "your-api-key-here"

if USE_AI:
    try:
        # openai_client = OpenAI(api_key=OPENAI_API_KEY)
        print("✅ AI Integration: ENABLED (OpenAI GPT-4)")
        openai_client = OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key="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",
)
    except Exception as e:
        print(f"⚠️  AI Integration: DISABLED - {e}")
        USE_AI = False
else:
    print("⚠️  AI Integration: DISABLED - Set OPENAI_API_KEY environment variable")

# ==================== STORAGE ====================

# Rules Library - Extracted rules organized by scheme and category
RULES_LIBRARY = {}

# Message Queue - For production message processing
MESSAGE_QUEUE = deque(maxlen=1000)  # Store last 1000 messages
PROCESSING_STATS = {
    "total_processed": 0,
    "compliant": 0,
    "non_compliant": 0,
    "processing": 0,
    "queue_size": 0
}

# Uploaded Rulebooks
UPLOADED_RULEBOOKS = {}

# ==================== MODELS ====================

class Rule(BaseModel):
    id: str
    scheme: str
    category: str
    title: str
    description: str
    severity: str
    example: Optional[str] = None
    source: str
    version: str
    createdAt: str

class Violation(BaseModel):
    severity: str
    rule: str
    issue: str
    impact: str
    suggestion: str

class PaymentAnalysis(BaseModel):
    id: str
    scheme: str
    amount: str
    currency: str
    sender: Optional[str]
    receiver: Optional[str]
    status: str
    violations: List[Violation]
    aiTime: str
    confidence: float
    aiPowered: bool = False
    rulebookSource: str = "default"
    queuePosition: Optional[int] = None

class ComplianceRequest(BaseModel):
    payment_data: Dict
    scheme: str

class BatchValidationRequest(BaseModel):
    payments: List[Dict]
    scheme: str

class QueuedMessage(BaseModel):
    id: str
    scheme: str
    status: str  # "pending", "processing", "completed", "failed"
    payment_data: Dict
    result: Optional[PaymentAnalysis] = None
    queuedAt: str
    processedAt: Optional[str] = None

# ==================== RULES LIBRARY FUNCTIONS ====================

def extract_rules_from_text(rulebook_text: str, scheme: str, version: str) -> List[Rule]:
    """
    Use AI to extract structured rules from rulebook text
    """
    if not USE_AI:
        return []
    
    try:
        prompt = f"""Extract compliance rules from this {scheme} payment scheme rulebook.

RULEBOOK TEXT:
{rulebook_text[:6000]}

For each rule, provide:
1. A unique ID (e.g., {scheme}_001)
2. Category (e.g., "Amount Limits", "Field Validation", "Character Set")
3. Title (brief, e.g., "Purpose Code Mandatory")
4. Description (detailed rule text)
5. Severity (high/medium/low)
6. Example violation scenario

Return as JSON array:
{{
  "rules": [
    {{
      "id": "string",
      "category": "string",
      "title": "string", 
      "description": "string",
      "severity": "high|medium|low",
      "example": "string"
    }}
  ]
}}

Extract 5-10 key rules."""

        response = openai_client.chat.completions.create(
            model="openai/gpt-oss-20b:free",
            messages=[
                {"role": "system", "content": "You are a payment compliance expert. Extract clear, structured rules from rulebooks."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            response_format={"type": "json_object"}
        )
        
        result = json.loads(response.choices[0].message.content)
        rules_data = result.get("rules", [])
        
        rules = []
        for idx, r in enumerate(rules_data):
            rule = Rule(
                id=r.get("id", f"{scheme}_{idx+1:03d}"),
                scheme=scheme,
                category=r.get("category", "General"),
                title=r.get("title", "Compliance Rule"),
                description=r.get("description", ""),
                severity=r.get("severity", "medium"),
                example=r.get("example"),
                source="extracted-from-pdf",
                version=version,
                createdAt=datetime.now().isoformat()
            )
            rules.append(rule)
        
        return rules
        
    except Exception as e:
        print(f"Error extracting rules: {e}")
        return []

def add_rule_to_library(rule: Rule):
    """Add a rule to the library"""
    scheme = rule.scheme.upper()
    if scheme not in RULES_LIBRARY:
        RULES_LIBRARY[scheme] = {}
    
    category = rule.category
    if category not in RULES_LIBRARY[scheme]:
        RULES_LIBRARY[scheme][category] = []
    
    RULES_LIBRARY[scheme][category].append(rule)

# ==================== MESSAGE QUEUE FUNCTIONS ====================

async def process_message_from_queue(message_id: str):
    """Process a queued message in background"""
    try:
        # Find message in queue
        message = None
        for msg in MESSAGE_QUEUE:
            if msg["id"] == message_id:
                message = msg
                break
        
        if not message:
            return
        
        message["status"] = "processing"
        PROCESSING_STATS["processing"] += 1
        
        # Validate payment
        payment = message["payment_data"]
        scheme = message["scheme"]
        
        violations, rulebook_source = AIComplianceChecker.analyze_with_pdf_rules(payment, scheme)
        
        status = "compliant" if len(violations) == 0 else "non-compliant"
        
        result = PaymentAnalysis(
            id=payment.get("id", "UNKNOWN"),
            scheme=scheme,
            amount=str(payment.get("amount", "0.00")),
            currency=payment.get("currency", ""),
            sender=payment.get("debtor_iban") or payment.get("ordering_customer"),
            receiver=payment.get("creditor_iban") or payment.get("beneficiary"),
            status=status,
            violations=violations,
            aiTime="background",
            confidence=99.5 if rulebook_source.startswith("uploaded-pdf") else 99.0,
            aiPowered=USE_AI,
            rulebookSource=rulebook_source
        )
        
        message["result"] = result.dict()
        message["status"] = "completed"
        message["processedAt"] = datetime.now().isoformat()
        
        PROCESSING_STATS["processing"] -= 1
        PROCESSING_STATS["total_processed"] += 1
        if status == "compliant":
            PROCESSING_STATS["compliant"] += 1
        else:
            PROCESSING_STATS["non_compliant"] += 1
            
    except Exception as e:
        message["status"] = "failed"
        message["error"] = str(e)
        PROCESSING_STATS["processing"] -= 1

# ==================== AI COMPLIANCE CHECKER ====================

class AIComplianceChecker:
    
    @staticmethod
    def analyze_with_pdf_rules(payment: Dict, scheme: str) -> tuple[List[Violation], str]:
        """Analyze payment using uploaded PDF rulebook or default rules"""
        if not USE_AI:
            return AIComplianceChecker.analyze_without_ai(payment, scheme), "rule-based"
        
        scheme_upper = scheme.upper()
        if scheme_upper in UPLOADED_RULEBOOKS:
            rulebook_text = UPLOADED_RULEBOOKS[scheme_upper]['text']
            rulebook_source = f"uploaded-pdf:{UPLOADED_RULEBOOKS[scheme_upper]['filename']}"
        else:
            # Use rules from library if available
            if scheme_upper in RULES_LIBRARY:
                rulebook_text = AIComplianceChecker.build_rulebook_from_library(scheme_upper)
                rulebook_source = "rules-library"
            else:
                rulebook_text = DEFAULT_RULEBOOKS.get(scheme_upper, "")
                rulebook_source = "default-rulebook"
        
        try:
            prompt = f"""Analyze this {scheme} payment against the rulebook:

RULEBOOK:
{rulebook_text[:8000]}

PAYMENT:
{json.dumps(payment, indent=2)}

Find violations and provide detailed analysis.

Return JSON:
{{
  "violations": [
    {{
      "severity": "high|medium|low",
      "rule": "specific rule reference",
      "issue": "what is wrong",
      "impact": "business impact",
      "suggestion": "how to fix"
    }}
  ]
}}"""

            # response = openai_client.chat.completions.create(
            #     model="openai/gpt-oss-20b:free",
            #     messages=[
            #         {"role": "system", "content": "You are a payment compliance analyst."},
            #         {"role": "user", "content": prompt}
            #     ],
            #     temperature=0.2,
            #     response_format={"type": "json_object"}
            # )
            response = openai_client.chat.completions.create(
  extra_headers={
    "HTTP-Referer": "http://localhost:3000/", # Optional. Site URL for rankings on openrouter.ai.
    "X-Title": "xyz", # Optional. Site title for rankings on openrouter.ai.
  },
  model="openai/gpt-4o",
   messages=[
                    {"role": "system", "content": "You are a payment compliance analyst."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                response_format={"type": "json_object"}
)

            
            result = json.loads(response.choices[0].message.content)
            violations_data = result.get("violations", [])
            
            violations = [
                Violation(
                    severity=v.get("severity", "medium"),
                    rule=v.get("rule", "Rulebook requirement"),
                    issue=v.get("issue", "Compliance issue detected"),
                    impact=v.get("impact", "May cause processing issues"),
                    suggestion=v.get("suggestion", "Review payment details")
                )
                for v in violations_data
            ]
            
            return violations, rulebook_source
            
        except Exception as e:
            print(f"AI Analysis Error: {e}")
            return AIComplianceChecker.analyze_without_ai(payment, scheme), "fallback-rules"
    
    @staticmethod
    def build_rulebook_from_library(scheme: str) -> str:
        """Build rulebook text from rules library"""
        if scheme not in RULES_LIBRARY:
            return ""
        
        text = f"{scheme} Compliance Rules (from Rules Library)\n\n"
        
        for category, rules in RULES_LIBRARY[scheme].items():
            text += f"\n{category}:\n"
            for rule in rules:
                text += f"\n- {rule.title}\n  {rule.description}\n"
        
        return text
    
    @staticmethod
    def analyze_without_ai(payment: Dict, scheme: str) -> List[Violation]:
        """Fallback rule-based analysis"""
        violations = []
        scheme = scheme.upper()
        
        if "SEPA" in scheme:
            amount = float(payment.get("amount", 0))
            if amount > 12500.0 and not payment.get("purpose_code"):
                violations.append(Violation(
                    severity="high",
                    rule="EPC Rulebook - Purpose Code Requirement",
                    issue=f"Missing Purpose Code for €{amount:,.2f}",
                    impact="Break STP, manual investigation required",
                    suggestion="Add Purpose Code: SUPP, SALA, or TRAD"
                ))
        
        return violations

# Default rulebooks (fallback)
DEFAULT_RULEBOOKS = {
    "SEPA": "EPC SEPA rules: Purpose Code mandatory for amounts > EUR 12,500",
    "SWIFT_MT103": "SWIFT MT103: Field 70 maximum 140 characters",
    "CHAPS": "CHAPS: GBP currency only",
    "SIX": "SIX: QR-IBAN requires structured reference"
}

# ==================== API ENDPOINTS ====================

@app.get("/")
def root():
    return {
        "service": "Payment Compliance API - Production",
        "version": "4.0.0",
        "status": "operational",
        "features": {
            "ai_enabled": USE_AI,
            "pdf_upload": True,
            "rules_library": True,
            "message_queue": True,
            "batch_validation": True
        },
        "stats": {
            "rules_in_library": sum(len(cats) for cats in RULES_LIBRARY.values() for rules in cats.values()),
            "uploaded_rulebooks": list(UPLOADED_RULEBOOKS.keys()),
            "queue_size": len(MESSAGE_QUEUE)
        }
    }

@app.post("/api/upload-rulebook")
async def upload_rulebook(scheme: str, file: UploadFile = File(...)):
    """Upload PDF rulebook and extract rules to library"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    try:
        pdf_content = await file.read()
        
        print(f"📄 Extracting text from {file.filename}...")
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_content))
        rulebook_text = ""
        for page in pdf_reader.pages:
            rulebook_text += page.extract_text() + "\n"
        
        if not rulebook_text or len(rulebook_text) < 100:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF")
        
        # Store rulebook
        scheme_upper = scheme.upper()
        version = "v2024.1"
        
        UPLOADED_RULEBOOKS[scheme_upper] = {
            'text': rulebook_text,
            'filename': file.filename,
            'upload_date': datetime.now().isoformat(),
            'pages': len(pdf_reader.pages),
            'text_length': len(rulebook_text),
            'version': version
        }
        
        # Extract rules to library
        print(f"🤖 Extracting rules to library...")
        rules = extract_rules_from_text(rulebook_text, scheme_upper, version)
        
        for rule in rules:
            add_rule_to_library(rule)
        
        print(f"✅ Extracted {len(rules)} rules to library")
        
        return {
            "success": True,
            "scheme": scheme_upper,
            "filename": file.filename,
            "pages": len(pdf_reader.pages),
            "text_length": len(rulebook_text),
            "rules_extracted": len(rules),
            "message": f"Rulebook uploaded and {len(rules)} rules added to library"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.get("/api/rules")
async def get_all_rules():
    """Get all rules from the library"""
    rules_flat = []
    for scheme, categories in RULES_LIBRARY.items():
        for category, rules in categories.items():
            rules_flat.extend([r.dict() for r in rules])
    
    return {
        "total_rules": len(rules_flat),
        "schemes": list(RULES_LIBRARY.keys()),
        "rules": rules_flat
    }

@app.get("/api/rules/{scheme}")
async def get_scheme_rules(scheme: str):
    """Get rules for specific scheme"""
    scheme_upper = scheme.upper()
    
    if scheme_upper not in RULES_LIBRARY:
        raise HTTPException(status_code=404, detail=f"No rules found for {scheme}")
    
    rules_by_category = {}
    for category, rules in RULES_LIBRARY[scheme_upper].items():
        rules_by_category[category] = [r.dict() for r in rules]
    
    return {
        "scheme": scheme_upper,
        "categories": list(rules_by_category.keys()),
        "total_rules": sum(len(rules) for rules in rules_by_category.values()),
        "rules_by_category": rules_by_category
    }

@app.post("/api/queue/add")
async def add_to_queue(request: ComplianceRequest, background_tasks: BackgroundTasks):
    """Add payment to processing queue"""
    payment = request.payment_data
    scheme = request.scheme.upper()
    
    message_id = f"MSG_{datetime.now().strftime('%Y%m%d_%H%M%S')}_{len(MESSAGE_QUEUE)}"
    
    queued_message = {
        "id": message_id,
        "scheme": scheme,
        "status": "pending",
        "payment_data": payment,
        "result": None,
        "queuedAt": datetime.now().isoformat(),
        "processedAt": None,
        "position": len(MESSAGE_QUEUE) + 1
    }
    
    MESSAGE_QUEUE.append(queued_message)
    PROCESSING_STATS["queue_size"] = len(MESSAGE_QUEUE)
    
    # Process in background
    background_tasks.add_task(process_message_from_queue, message_id)
    
    return {
        "success": True,
        "message_id": message_id,
        "queue_position": queued_message["position"],
        "status": "queued",
        "message": "Payment added to queue for processing"
    }

@app.get("/api/queue/status/{message_id}")
async def get_queue_status(message_id: str):
    """Get status of queued message"""
    for message in MESSAGE_QUEUE:
        if message["id"] == message_id:
            return message
    
    raise HTTPException(status_code=404, detail="Message not found in queue")

@app.get("/api/queue/list")
async def list_queue():
    """List all messages in queue"""
    return {
        "total": len(MESSAGE_QUEUE),
        "messages": list(MESSAGE_QUEUE)
    }

@app.post("/api/validate", response_model=PaymentAnalysis)
async def validate_payment(request: ComplianceRequest):
    """Immediate validation (not queued)"""
    start_time = datetime.now()
    
    payment = request.payment_data
    scheme = request.scheme.upper()
    
    violations, rulebook_source = AIComplianceChecker.analyze_with_pdf_rules(payment, scheme)
    processing_time = (datetime.now() - start_time).total_seconds()
    
    status = "compliant" if len(violations) == 0 else "non-compliant"
    
    if rulebook_source.startswith("uploaded-pdf"):
        confidence = 99.5
    elif rulebook_source == "rules-library":
        confidence = 99.3
    else:
        confidence = 99.0
    
    return PaymentAnalysis(
        id=payment.get("id", "UNKNOWN"),
        scheme=scheme,
        amount=str(payment.get("amount", "0.00")),
        currency=payment.get("currency", ""),
        sender=payment.get("debtor_iban") or payment.get("ordering_customer"),
        receiver=payment.get("creditor_iban") or payment.get("beneficiary"),
        status=status,
        violations=violations,
        aiTime=f"{processing_time:.2f} seconds",
        confidence=confidence,
        aiPowered=USE_AI,
        rulebookSource=rulebook_source
    )

@app.post("/api/validate/batch")
async def validate_batch(request: BatchValidationRequest, background_tasks: BackgroundTasks):
    """Batch validate multiple payments"""
    payments = request.payments
    scheme = request.scheme
    
    batch_id = f"BATCH_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    
    # Add all to queue
    message_ids = []
    for idx, payment in enumerate(payments):
        message_id = f"{batch_id}_{idx+1:03d}"
        
        queued_message = {
            "id": message_id,
            "scheme": scheme,
            "status": "pending",
            "payment_data": payment,
            "result": None,
            "queuedAt": datetime.now().isoformat(),
            "batch_id": batch_id
        }
        
        MESSAGE_QUEUE.append(queued_message)
        message_ids.append(message_id)
        
        # Process in background
        background_tasks.add_task(process_message_from_queue, message_id)
    
    PROCESSING_STATS["queue_size"] = len(MESSAGE_QUEUE)
    
    return {
        "success": True,
        "batch_id": batch_id,
        "total_payments": len(payments),
        "message_ids": message_ids,
        "status": "processing"
    }

@app.get("/api/rulebooks")
def list_rulebooks():
    """List all uploaded rulebooks (for frontend compatibility)"""
    return {
        "uploaded_rulebooks": list(UPLOADED_RULEBOOKS.keys()),
        "total": len(UPLOADED_RULEBOOKS)
    }


@app.get("/api/statistics")
def get_statistics():
    """Get processing statistics"""
    return {
        **PROCESSING_STATS,
        "rules_library_size": sum(len(cats) for cats in RULES_LIBRARY.values() for rules in cats.values()),
        "uploaded_rulebooks": len(UPLOADED_RULEBOOKS),
        "ai_enabled": USE_AI
    }



@app.get("/api/ai-status")
def get_ai_status():
    """Check AI and system status"""
    return {
        "ai_enabled": USE_AI,
        "provider": "OpenAI GPT-4" if USE_AI else "None",
        "features": {
            "pdf_upload": True,
            "rules_library": True,
            "message_queue": True,
            "rules_count": sum(len(cats) for cats in RULES_LIBRARY.values() for rules in cats.values())
        },
        "uploaded_rulebooks": list(UPLOADED_RULEBOOKS.keys()),
        "queue_stats": {
            "current_size": len(MESSAGE_QUEUE),
            "processing": PROCESSING_STATS["processing"],
            "total_processed": PROCESSING_STATS["total_processed"]
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
