"""
PACS.008 Payment Compliance Detection System
Validates SEPA PACS.008 XML payments against rulebook requirements
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict
import json
import xml.etree.ElementTree as ET
from datetime import datetime
import os
from openai import OpenAI
import PyPDF2
import io
from collections import deque
import dotenv

dotenv.load_dotenv()

app = FastAPI(title="PACS.008 Compliance API", version="1.0.0")

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
        openai_client = OpenAI(
            base_url="https://openrouter.ai/api/v1",
            api_key="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",
        )
        print("✅ AI Integration: ENABLED")
    except Exception as e:
        print(f"⚠️ AI Integration: DISABLED - {e}")
        USE_AI = False
else:
    print("⚠️ AI Integration: DISABLED")

# Storage
RULES_LIBRARY = {}
MESSAGE_QUEUE = deque(maxlen=1000)
PROCESSING_STATS = {
    "total_processed": 0,
    "compliant": 0,
    "non_compliant": 0,
    "processing": 0,
    "queue_size": 0
}
UPLOADED_RULEBOOKS = {}

# Models
class Rule(BaseModel):
    id: str
    scheme: str
    category: str
    title: str
    description: str
    severity: str
    xmlPath: Optional[str] = None
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
    xmlPath: Optional[str] = None

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

class ComplianceRequest(BaseModel):
    payment_data: Dict
    scheme: str

# ==================== XML PARSER ====================

def parse_pacs008_xml(xml_content: str) -> Dict:
    """Parse PACS.008 XML and extract payment data"""
    try:
        # Remove XML declaration and namespaces for easier parsing
        xml_content = xml_content.replace('<?xml version="1.0" encoding="utf-8"?>', '')
        root = ET.fromstring(xml_content)
        
        # Remove namespace from tags
        for elem in root.iter():
            if '}' in elem.tag:
                elem.tag = elem.tag.split('}')[1]
        
        # Extract payment data
        payment_data = {
            "message_type": "PACS.008",
            "scheme": "SEPA",
        }
        
        # Group Header
        grp_hdr = root.find('.//GrpHdr')
        if grp_hdr is not None:
            payment_data["message_id"] = get_text(grp_hdr, 'MsgId')
            payment_data["creation_date_time"] = get_text(grp_hdr, 'CreDtTm')
            payment_data["number_of_transactions"] = get_text(grp_hdr, 'NbOfTxs')
            payment_data["settlement_date"] = get_text(grp_hdr, 'IntrBkSttlmDt')
            
            # Total Amount
            amt = grp_hdr.find('.//TtlIntrBkSttlmAmt')
            if amt is not None:
                payment_data["total_amount"] = amt.text
                payment_data["currency"] = amt.get('Ccy', 'EUR')
            
            # Settlement Method
            payment_data["settlement_method"] = get_text(grp_hdr, './/SttlmMtd')
            payment_data["clearing_system"] = get_text(grp_hdr, './/Prtry')
            
            # Service Level
            payment_data["service_level"] = get_text(grp_hdr, './/SvcLvl/Cd')
            payment_data["local_instrument"] = get_text(grp_hdr, './/LclInstrm/Cd')
            payment_data["category_purpose"] = get_text(grp_hdr, './/CtgyPurp/Cd')
            
            # Instructing/Instructed Agent
            payment_data["instructing_agent"] = get_text(grp_hdr, './/InstgAgt/FinInstnId/BICFI')
            payment_data["instructed_agent"] = get_text(grp_hdr, './/InstdAgt/FinInstnId/BICFI')
        
        # Credit Transfer Transaction Information
        cdt_trf = root.find('.//CdtTrfTxInf')
        if cdt_trf is not None:
            # Payment Identification
            payment_data["instruction_id"] = get_text(cdt_trf, './/InstrId')
            payment_data["end_to_end_id"] = get_text(cdt_trf, './/EndToEndId')
            payment_data["transaction_id"] = get_text(cdt_trf, './/TxId')
            
            # Transaction Amount
            amt = cdt_trf.find('.//IntrBkSttlmAmt')
            if amt is not None:
                payment_data["amount"] = amt.text
                payment_data["currency"] = amt.get('Ccy', 'EUR')
            
            payment_data["acceptance_date_time"] = get_text(cdt_trf, './/AccptncDtTm')
            payment_data["charge_bearer"] = get_text(cdt_trf, './/ChrgBr')
            
            # Ultimate Debtor
            ult_dbtr = cdt_trf.find('.//UltmtDbtr')
            if ult_dbtr is not None:
                payment_data["ultimate_debtor_name"] = get_text(ult_dbtr, 'Nm')
                payment_data["ultimate_debtor_bic"] = get_text(ult_dbtr, './/AnyBIC')
                payment_data["ultimate_debtor_lei"] = get_text(ult_dbtr, './/LEI')
            
            # Debtor
            dbtr = cdt_trf.find('.//Dbtr')
            if dbtr is not None:
                payment_data["debtor_name"] = get_text(dbtr, 'Nm')
                payment_data["debtor_country"] = get_text(dbtr, './/Ctry')
                payment_data["debtor_id"] = get_text(dbtr, './/Id')
            
            # Debtor Account
            payment_data["debtor_iban"] = get_text(cdt_trf, './/DbtrAcct/Id/IBAN')
            payment_data["debtor_proxy"] = get_text(cdt_trf, './/DbtrAcct/Prxy/Id')
            
            # Debtor Agent
            payment_data["debtor_agent"] = get_text(cdt_trf, './/DbtrAgt/FinInstnId/BICFI')
            
            # Creditor Agent
            payment_data["creditor_agent"] = get_text(cdt_trf, './/CdtrAgt/FinInstnId/BICFI')
            
            # Creditor
            cdtr = cdt_trf.find('.//Cdtr')
            if cdtr is not None:
                payment_data["creditor_name"] = get_text(cdtr, 'Nm')
                payment_data["creditor_country"] = get_text(cdtr, './/Ctry')
            
            # Creditor Account
            payment_data["creditor_iban"] = get_text(cdt_trf, './/CdtrAcct/Id/IBAN')
            payment_data["creditor_proxy"] = get_text(cdt_trf, './/CdtrAcct/Prxy/Id')
            
            # Ultimate Creditor
            ult_cdtr = cdt_trf.find('.//UltmtCdtr')
            if ult_cdtr is not None:
                payment_data["ultimate_creditor_name"] = get_text(ult_cdtr, 'Nm')
                payment_data["ultimate_creditor_lei"] = get_text(ult_cdtr, './/LEI')
            
            # Remittance Information
            payment_data["remittance_unstructured"] = get_text(cdt_trf, './/RmtInf/Ustrd')
            payment_data["creditor_reference"] = get_text(cdt_trf, './/RmtInf/Strd/CdtrRefInf/Ref')
            payment_data["creditor_reference_type"] = get_text(cdt_trf, './/RmtInf/Strd/CdtrRefInf/Tp/CdOrPrtry/Cd')
        
        # Set ID for display
        payment_data["id"] = payment_data.get("transaction_id", payment_data.get("message_id", "UNKNOWN"))
        
        return payment_data
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing PACS.008 XML: {str(e)}")

def get_text(element, path: str) -> Optional[str]:
    """Safely get text from XML element"""
    if element is None:
        return None
    found = element.find(path)
    return found.text if found is not None else None

# ==================== SEPA PACS.008 RULES ====================

# SEPA_PACS008_RULES = """
# SEPA PACS.008 Credit Transfer Compliance Rules (EPC115-06 v2023)

# MANDATORY FIELDS:
# 1. Message ID (MsgId) - Unique message identifier, 1-35 characters
# 2. Creation Date Time (CreDtTm) - ISO 8601 format
# 3. Number of Transactions (NbOfTxs) - Must match actual count
# 4. Total Interbank Settlement Amount - EUR currency only, 0.01 to 999999999.99
# 5. Interbank Settlement Date (IntrBkSttlmDt) - Settlement date
# 6. Settlement Method (SttlmMtd) - Only CLRG, INGA, INDA allowed
# 7. Service Level Code - Must be "SEPA"
# 8. End To End ID - Originator's reference, "NOTPROVIDED" if not given
# 9. Transaction ID (TxId) - Originator PSP's reference, unique, 1-35 characters
# 10. Interbank Settlement Amount - EUR only, 0.01 to 999999999.99, max 2 decimals
# 11. Charge Bearer (ChrgBr) - Only "SLEV" allowed
# 12. Debtor Name - Name of originator, mandatory, max 70 characters
# 13. Debtor Account IBAN - Valid IBAN format
# 14. Debtor Agent BIC - Valid BIC code
# 15. Creditor Agent BIC - Valid BIC code
# 16. Creditor Name - Name of beneficiary, mandatory, max 70 characters
# 17. Creditor Account IBAN - Valid IBAN format

# AMOUNT VALIDATION:
# - Currency must be EUR
# - Amount range: 0.01 to 999,999,999.99
# - Maximum 2 decimal places
# - Total amount must match sum of individual transactions

# IDENTIFIER VALIDATION:
# - IBAN: Must follow ISO 13616 format
# - BIC: Must follow ISO 9362 format (8 or 11 characters)
# - Message ID: 1-35 characters, unique
# - End-to-End ID: 1-35 characters, pass through unchanged
# - Transaction ID: 1-35 characters, unique per PSP

# CHARACTER SET:
# - SEPA character set only: a-z A-Z 0-9 / - ? : ( ) . , ' + Space
# - No special characters outside SEPA set

# ADDRESS VALIDATION:
# - If Address Line used, other postal elements forbidden except Country
# - Debtor/Creditor postal address mandatory for non-EEA SEPA participants
# - Country code: ISO 3166-1 alpha-2 (2 characters)

# REMITTANCE INFORMATION:
# - Unstructured: Max 140 characters
# - Structured: Max 140 characters (excluding tags)
# - Creditor Reference Type: Only "SCOR" allowed
# - Either structured OR unstructured, not both

# PURPOSE CODE:
# - Category Purpose: Optional, forwarded if agreed
# - Allowed codes: CASH, SUPP, SALA, TRAD, etc.

# PROXY/ALIAS:
# - Only allowed if IBAN validation provided before authentication
# - Type code required (e.g., TELE for telephone)

# LOCAL INSTRUMENT:
# - Only used if bilaterally agreed between PSPs

# TIME CONSTRAINTS:
# - Settlement must be same business day or next business day
# - Creation date time must be valid ISO 8601

# PARTY IDENTIFICATION:
# - Organisation ID: AnyBIC, LEI, or one 'Other' allowed
# - Private ID: Date/Place of Birth or one 'Other' allowed
# - "NOTPROVIDED" used when no ID available
# """

# ==================== AI COMPLIANCE CHECKER ====================

class AIComplianceChecker:
    
    @staticmethod
    def analyze_pacs008_payment(payment: Dict, rulebook_text: str = None) -> tuple[List[Violation], str]:
        """Analyze PACS.008 payment using AI and rulebook"""
        if not USE_AI:
            return AIComplianceChecker.analyze_without_ai(payment), "rule-based"
        
        # Use uploaded rulebook or default SEPA rules
        if rulebook_text is None:
            rulebook_text = SEPA_PACS008_RULES
            rulebook_source = "default-sepa-rules"
        else:
            rulebook_source = "uploaded-rulebook"
        
        try:
            prompt = f"""You are a SEPA payment compliance expert analyzing a PACS.008 credit transfer message.

SEPA PACS.008 RULEBOOK:
{rulebook_text[:10000]}

PAYMENT MESSAGE DATA (extracted from XML):
{json.dumps(payment, indent=2)}

TASK:
Analyze this PACS.008 payment against SEPA rulebook requirements. For each violation:

1. Identify severity (high/medium/low)
   - HIGH: Mandatory field missing/invalid, payment will be rejected
   - MEDIUM: Format issue, may cause delays
   - LOW: Best practice violation, advisory only

2. Reference specific rule from rulebook (e.g., "AT-D001", "Service Level requirement")

3. Describe the exact issue with actual values from the payment

4. Explain business impact (rejection, delay, manual processing)

5. Provide actionable fix

CHECK THESE CRITICAL AREAS:
- Mandatory fields present and valid
- Amount format and currency (EUR only, 2 decimals, range 0.01-999999999.99)
- Service Level Code must be "SEPA"
- Charge Bearer must be "SLEV"
- IBAN format validation
- BIC format validation (8 or 11 chars)
- Character set compliance (SEPA charset only)
- Name fields max 70 characters
- End-to-End ID present ("NOTPROVIDED" if not given)
- Settlement method (CLRG/INGA/INDA only)

Return JSON:
{{
  "violations": [
    {{
      "severity": "high|medium|low",
      "rule": "specific rule reference",
      "issue": "exact problem with field value",
      "impact": "business consequence",
      "suggestion": "how to fix",
      "xmlPath": "XML path if applicable"
    }}
  ]
}}

If compliant, return empty violations array."""

            response = openai_client.chat.completions.create(
                extra_headers={
                    "HTTP-Referer": "http://localhost:3000/",
                    "X-Title": "PACS008 Validator",
                },
                model="openai/gpt-oss-20b:free",
                messages=[
                    {"role": "system", "content": "You are a SEPA PACS.008 payment compliance expert. Analyze payments with precision against rulebook requirements."},
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
                    rule=v.get("rule", "SEPA requirement"),
                    issue=v.get("issue", "Compliance issue detected"),
                    impact=v.get("impact", "May cause processing issues"),
                    suggestion=v.get("suggestion", "Review field value"),
                    xmlPath=v.get("xmlPath")
                )
                for v in violations_data
            ]
            
            return violations, rulebook_source
            
        except Exception as e:
            print(f"AI Analysis Error: {e}")
            return AIComplianceChecker.analyze_without_ai(payment), "fallback-rules"
    
    @staticmethod
    def analyze_without_ai(payment: Dict) -> List[Violation]:
        """Fallback rule-based analysis for PACS.008"""
        violations = []
        
        # Check mandatory Service Level
        if payment.get("service_level") != "SEPA":
            violations.append(Violation(
                severity="high",
                rule="AT-T001: Service Level Code",
                issue=f"Service Level is '{payment.get('service_level')}' but must be 'SEPA'",
                impact="Payment will be rejected by SEPA system",
                suggestion="Set Service Level Code to 'SEPA'",
                xmlPath="GrpHdr/PmtTpInf/SvcLvl/Cd"
            ))
        
        # Check currency
        if payment.get("currency") != "EUR":
            violations.append(Violation(
                severity="high",
                rule="AT-T002: Currency Requirement",
                issue=f"Currency is '{payment.get('currency')}' but SEPA only accepts EUR",
                impact="Payment will be rejected",
                suggestion="Change currency to EUR",
                xmlPath="CdtTrfTxInf/IntrBkSttlmAmt[@Ccy]"
            ))
        
        # Check Charge Bearer
        if payment.get("charge_bearer") != "SLEV":
            violations.append(Violation(
                severity="high",
                rule="Charge Bearer Requirement",
                issue=f"Charge Bearer is '{payment.get('charge_bearer')}' but must be 'SLEV'",
                impact="Payment will be rejected",
                suggestion="Set Charge Bearer to 'SLEV'",
                xmlPath="CdtTrfTxInf/ChrgBr"
            ))
        
        # Check amount format
        try:
            amount = float(payment.get("amount", 0))
            if amount < 0.01 or amount > 999999999.99:
                violations.append(Violation(
                    severity="high",
                    rule="Amount Range Validation",
                    issue=f"Amount {amount} is outside valid range 0.01-999999999.99",
                    impact="Payment will be rejected",
                    suggestion="Ensure amount is between 0.01 and 999,999,999.99",
                    xmlPath="CdtTrfTxInf/IntrBkSttlmAmt"
                ))
        except:
            pass
        
        # Check mandatory fields
        mandatory_fields = {
            "debtor_name": "Debtor Name (AT-P001)",
            "creditor_name": "Creditor Name (AT-E001)",
            "debtor_iban": "Debtor IBAN (AT-D001)",
            "creditor_iban": "Creditor IBAN (AT-C001)",
            "debtor_agent": "Debtor Agent BIC (AT-D002)",
            "creditor_agent": "Creditor Agent BIC (AT-C002)"
        }
        
        for field, rule_name in mandatory_fields.items():
            if not payment.get(field):
                violations.append(Violation(
                    severity="high",
                    rule=rule_name,
                    issue=f"Mandatory field '{field}' is missing",
                    impact="Payment will be rejected",
                    suggestion=f"Provide {field}",
                    xmlPath=f"CdtTrfTxInf//{field}"
                ))
        
        return violations

# ==================== PDF PROCESSING ====================

def extract_rules_from_pdf(pdf_text: str, scheme: str) -> List[Rule]:
    """Extract SEPA rules from PDF using AI"""
    if not USE_AI:
        print("AI not enabled, returning default rules")
        return create_default_sepa_rules(scheme)
    
    try:
        # Split text into chunks if too large
        chunk_size = 12000
        text_chunks = [pdf_text[i:i+chunk_size] for i in range(0, min(len(pdf_text), 24000), chunk_size)]
        
        all_rules = []
        
        for chunk_idx, chunk in enumerate(text_chunks[:2]):  # Process first 2 chunks
            print(f"Processing chunk {chunk_idx + 1}/{len(text_chunks[:2])}...")
            
            prompt = f"""You are analyzing a SEPA PACS.008 rulebook document. Extract compliance rules from this text.

RULEBOOK TEXT (Part {chunk_idx + 1}):
{chunk}

TASK: Extract SEPA compliance rules. Look for:
- Mandatory field requirements (e.g., "Mandatory", "SEPA Usage Rule(s)")
- Field format rules (e.g., "Only EUR allowed", "Max 70 characters")
- Validation rules (e.g., "IBAN required", "BIC format")
- Amount ranges and limits
- Code restrictions (e.g., "Only SEPA allowed", "Only SLEV allowed")

For EACH rule you find, extract:
1. **ID**: Look for rule IDs like AT-T001, AT-D001, AT-C001, or create SEPA_001, SEPA_002, etc.
2. **Category**: Group into categories like "Mandatory Fields", "Amount Validation", "Format Rules", "IBAN/BIC Validation"
3. **Title**: Brief title (e.g., "Service Level Code Must Be SEPA")
4. **Description**: Full rule text with requirements
5. **Severity**: 
   - "high" if mandatory/will cause rejection
   - "medium" if format issue/may cause delays
   - "low" if advisory/best practice
6. **xmlPath**: XML element path if mentioned (e.g., "GrpHdr/SvcLvl/Cd")
7. **Example**: Example of violation

Extract 8-12 distinct rules. Return as JSON:
{{
  "rules": [
    {{
      "id": "AT-T001",
      "category": "Service Level",
      "title": "Service Level Code Requirement",
      "description": "The Service Level Code must be set to SEPA for SEPA Credit Transfers",
      "severity": "high",
      "xmlPath": "GrpHdr/PmtTpInf/SvcLvl/Cd",
      "example": "Setting service level to SWIFT instead of SEPA will cause rejection"
    }}
  ]
}}"""

            response = openai_client.chat.completions.create(
                extra_headers={
                    "HTTP-Referer": "http://localhost:3000/",
                    "X-Title": "Rule Extractor",
                },
                model="openai/gpt-oss-20b:free",
                messages=[
                    {"role": "system", "content": "You are a payment compliance expert specializing in SEPA PACS.008 rules. Extract clear, actionable compliance rules from rulebook text."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            rules_data = result.get("rules", [])
            
            print(f"Extracted {len(rules_data)} rules from chunk {chunk_idx + 1}")
            
            for r in rules_data:
                rule = Rule(
                    id=r.get("id", f"SEPA_{len(all_rules)+1:03d}"),
                    scheme=scheme,
                    category=r.get("category", "General"),
                    title=r.get("title", "Compliance Rule"),
                    description=r.get("description", ""),
                    severity=r.get("severity", "medium"),
                    xmlPath=r.get("xmlPath"),
                    example=r.get("example"),
                    source="extracted-from-pdf",
                    version="v2023",
                    createdAt=datetime.now().isoformat()
                )
                all_rules.append(rule)
        
        if len(all_rules) == 0:
            print("No rules extracted, using defaults")
            return create_default_sepa_rules(scheme)
        
        print(f"Total rules extracted: {len(all_rules)}")
        return all_rules
        
    except Exception as e:
        print(f"Error extracting rules: {e}")
        import traceback
        traceback.print_exc()
        return create_default_sepa_rules(scheme)

def create_default_sepa_rules(scheme: str) -> List[Rule]:
    """Create default SEPA PACS.008 rules as fallback"""
    print("Creating default SEPA rules...")
    
    default_rules = [
        {
            "id": "AT-T001",
            "category": "Service Level",
            "title": "Service Level Code Must Be SEPA",
            "description": "SEPA Usage Rule: Only 'SEPA' is allowed as Service Level Code for SEPA Credit Transfers",
            "severity": "high",
            "xmlPath": "GrpHdr/PmtTpInf/SvcLvl/Cd",
            "example": "If Service Level is set to 'INST' or 'URGP', payment will be rejected"
        },
        {
            "id": "AT-T002",
            "category": "Amount Validation",
            "title": "Currency Must Be EUR",
            "description": "SEPA Usage Rule: Only 'EUR' is allowed as currency. Amount must be 0.01 or more and 999999999.99 or less",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/IntrBkSttlmAmt",
            "example": "Using USD or GBP currency will cause immediate rejection"
        },
        {
            "id": "AT-T051",
            "category": "Settlement",
            "title": "Settlement Date Required",
            "description": "SEPA Rulebook AT-T051: Settlement Date of the Credit Transfer is mandatory",
            "severity": "high",
            "xmlPath": "GrpHdr/IntrBkSttlmDt",
            "example": "Missing settlement date will prevent processing"
        },
        {
            "id": "ChrgBr-Rule",
            "category": "Charges",
            "title": "Charge Bearer Must Be SLEV",
            "description": "SEPA Usage Rule: Only 'SLEV' is allowed for Charge Bearer",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/ChrgBr",
            "example": "Using 'SHAR' or 'CRED' will cause rejection"
        },
        {
            "id": "AT-D001",
            "category": "IBAN Validation",
            "title": "Debtor IBAN Required",
            "description": "SEPA Rulebook AT-D001: The IBAN of the account of the Originator is mandatory",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/DbtrAcct/Id/IBAN",
            "example": "Missing or invalid IBAN format will cause rejection"
        },
        {
            "id": "AT-C001",
            "category": "IBAN Validation",
            "title": "Creditor IBAN Required",
            "description": "SEPA Rulebook AT-C001: The IBAN of the account of the Beneficiary is mandatory",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/CdtrAcct/Id/IBAN",
            "example": "Missing or invalid IBAN will prevent payment processing"
        },
        {
            "id": "AT-D002",
            "category": "BIC Validation",
            "title": "Debtor Agent BIC Required",
            "description": "SEPA Rulebook AT-D002: The BIC code of the Originator PSP is mandatory",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/DbtrAgt/FinInstnId/BICFI",
            "example": "Missing BIC code will cause payment rejection"
        },
        {
            "id": "AT-C002",
            "category": "BIC Validation",
            "title": "Creditor Agent BIC Required",
            "description": "SEPA Rulebook AT-C002: The BIC code of the Beneficiary PSP is mandatory",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/CdtrAgt/FinInstnId/BICFI",
            "example": "Invalid BIC format will cause rejection"
        },
        {
            "id": "AT-P001",
            "category": "Party Information",
            "title": "Debtor Name Mandatory",
            "description": "SEPA Rulebook AT-P001: Name of the Originator is mandatory, limited to 70 characters",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/Dbtr/Nm",
            "example": "Missing debtor name or exceeding 70 characters will cause issues"
        },
        {
            "id": "AT-E001",
            "category": "Party Information",
            "title": "Creditor Name Mandatory",
            "description": "SEPA Rulebook AT-E001: Name of the Beneficiary is mandatory, limited to 70 characters",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/Cdtr/Nm",
            "example": "Missing creditor name will prevent payment completion"
        },
        {
            "id": "AT-T014",
            "category": "Payment Identification",
            "title": "End-to-End ID Required",
            "description": "SEPA Rulebook AT-T014: The Originator's Reference must be passed in end-to-end chain. Use NOTPROVIDED if not given",
            "severity": "medium",
            "xmlPath": "CdtTrfTxInf/PmtId/EndToEndId",
            "example": "Empty End-to-End ID should be set to NOTPROVIDED"
        },
        {
            "id": "AT-T054",
            "category": "Payment Identification",
            "title": "Transaction ID Required and Unique",
            "description": "SEPA Rulebook AT-T054: The Originator PSP's reference must be unique and meaningful, 1-35 characters",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/PmtId/TxId",
            "example": "Duplicate or missing Transaction ID will cause rejection"
        },
        {
            "id": "SttlmMtd-Rule",
            "category": "Settlement",
            "title": "Settlement Method Restriction",
            "description": "SEPA Usage Rule: Only CLRG, INGA, and INDA are allowed as Settlement Method",
            "severity": "high",
            "xmlPath": "GrpHdr/SttlmInf/SttlmMtd",
            "example": "Using other settlement methods will cause rejection"
        },
        {
            "id": "Amount-Format",
            "category": "Amount Validation",
            "title": "Amount Decimal Format",
            "description": "SEPA Format Rule: The fractional part has a maximum of two digits",
            "severity": "medium",
            "xmlPath": "CdtTrfTxInf/IntrBkSttlmAmt",
            "example": "Amount like 100.123 with 3 decimals will be rejected"
        },
        {
            "id": "IBAN-Format",
            "category": "IBAN Validation",
            "title": "IBAN Format Validation",
            "description": "IBAN must follow ISO 13616 format without additional suffixes or prefixes",
            "severity": "high",
            "xmlPath": "CdtTrfTxInf/DbtrAcct/Id/IBAN",
            "example": "IBAN with EU suffix like IT76803593016000119552001EU is invalid"
        }
    ]
    
    rules = []
    for r in default_rules:
        rule = Rule(
            id=r["id"],
            scheme=scheme,
            category=r["category"],
            title=r["title"],
            description=r["description"],
            severity=r["severity"],
            xmlPath=r["xmlPath"],
            example=r["example"],
            source="default-rules",
            version="v2023",
            createdAt=datetime.now().isoformat()
        )
        rules.append(rule)
    
    print(f"Created {len(rules)} default rules")
    return rules

# ==================== API ENDPOINTS ====================

@app.get("/")
def root():
    return {
        "service": "PACS.008 Compliance API",
        "version": "1.0.0",
        "status": "operational",
        "message_types": ["PACS.008"],
        "schemes": ["SEPA"],
        "ai_enabled": USE_AI,
        "features": {
            "xml_parsing": True,
            "ai_validation": True,
            "pdf_rulebook_upload": True,
            "rules_library": True
        }
    }

@app.post("/api/upload-payment")
async def upload_payment(file: UploadFile = File(...)):
    """Upload and parse PACS.008 XML payment file"""
    try:
        content = await file.read()
        xml_content = content.decode('utf-8')
        
        # Parse XML to structured data
        payment_data = parse_pacs008_xml(xml_content)
        
        return {
            "success": True,
            "message": "Payment parsed successfully",
            "payment_data": payment_data,
            "message_type": "PACS.008",
            "scheme": "SEPA"
        }
        
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Error parsing payment: {str(e)}")

@app.post("/api/validate", response_model=PaymentAnalysis)
async def validate_payment(request: ComplianceRequest):
    """Validate PACS.008 payment using AI"""
    start_time = datetime.now()
    
    payment = request.payment_data
    
    # Get rulebook text if uploaded
    rulebook_text = None
    rulebook_source = "default-sepa-rules"
    
    if "SEPA" in UPLOADED_RULEBOOKS:
        rulebook_text = UPLOADED_RULEBOOKS["SEPA"]["text"]
        rulebook_source = f"uploaded-pdf:{UPLOADED_RULEBOOKS['SEPA']['filename']}"
    
    # Analyze with AI
    violations, source = AIComplianceChecker.analyze_pacs008_payment(payment, rulebook_text)
    
    processing_time = (datetime.now() - start_time).total_seconds()
    status = "compliant" if len(violations) == 0 else "non-compliant"
    
    return PaymentAnalysis(
        id=payment.get("id", "UNKNOWN"),
        scheme=payment.get("scheme", "SEPA"),
        amount=payment.get("amount", "0.00"),
        currency=payment.get("currency", "EUR"),
        sender=payment.get("debtor_iban") or payment.get("debtor_name"),
        receiver=payment.get("creditor_iban") or payment.get("creditor_name"),
        status=status,
        violations=violations,
        aiTime=f"{processing_time:.2f}s",
        confidence=99.5 if rulebook_source.startswith("uploaded-pdf") else 98.0,
        aiPowered=USE_AI,
        rulebookSource=source
    )

@app.post("/api/upload-rulebook")
async def upload_rulebook(scheme: str, file: UploadFile = File(...)):
    """Upload SEPA PACS.008 rulebook PDF"""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files supported")
    
    try:
        pdf_content = await file.read()
        
        # Extract text
        pdf_reader = PyPDF2.PdfReader(io.BytesIO(pdf_content))
        rulebook_text = ""
        for page in pdf_reader.pages:
            rulebook_text += page.extract_text() + "\n"
        
        if len(rulebook_text) < 100:
            raise HTTPException(status_code=400, detail="Could not extract text from PDF")
        
        # Store rulebook
        UPLOADED_RULEBOOKS["SEPA"] = {
            'text': rulebook_text,
            'filename': file.filename,
            'upload_date': datetime.now().isoformat(),
            'pages': len(pdf_reader.pages),
            'text_length': len(rulebook_text),
            'version': "v2023"
        }
        
        # Extract rules
        rules = extract_rules_from_pdf(rulebook_text, "SEPA")
        
        # Add to library
        if "SEPA" not in RULES_LIBRARY:
            RULES_LIBRARY["SEPA"] = {}
        
        for rule in rules:
            if rule.category not in RULES_LIBRARY["SEPA"]:
                RULES_LIBRARY["SEPA"][rule.category] = []
            RULES_LIBRARY["SEPA"][rule.category].append(rule)
        
        return {
            "success": True,
            "scheme": "SEPA",
            "filename": file.filename,
            "pages": len(pdf_reader.pages),
            "text_length": len(rulebook_text),
            "rules_extracted": len(rules),
            "message": f"SEPA rulebook uploaded, {len(rules)} rules extracted"
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error: {str(e)}")

@app.get("/api/rules")
async def get_all_rules():
    """Get all extracted rules"""
    rules_flat = []
    for scheme, categories in RULES_LIBRARY.items():
        for category, rules in categories.items():
            rules_flat.extend([r.dict() for r in rules])
    
    return {
        "total_rules": len(rules_flat),
        "schemes": list(RULES_LIBRARY.keys()),
        "rules": rules_flat
    }

@app.get("/api/rulebooks")
def list_rulebooks():
    """List uploaded rulebooks"""
    return {
        "uploaded_rulebooks": list(UPLOADED_RULEBOOKS.keys()),
        "total": len(UPLOADED_RULEBOOKS),
        "details": {k: {
            "filename": v["filename"],
            "pages": v["pages"],
            "upload_date": v["upload_date"]
        } for k, v in UPLOADED_RULEBOOKS.items()}
    }

@app.get("/api/statistics")
def get_statistics():
    """Get processing statistics"""
    return {
        **PROCESSING_STATS,
        "message_type": "PACS.008",
        "scheme": "SEPA",
        "rules_library_size": sum(len(r) for cats in RULES_LIBRARY.values() for r in cats.values()),
        "ai_enabled": USE_AI
    }

@app.get("/api/ai-status")
def get_ai_status():
    """Check AI status"""
    return {
        "ai_enabled": USE_AI,
        "provider": "OpenAI GPT-4" if USE_AI else "None",
        "message_type": "PACS.008",
        "scheme": "SEPA",
        "uploaded_rulebooks": list(UPLOADED_RULEBOOKS.keys()),
        "rules_count": sum(len(r) for cats in RULES_LIBRARY.values() for r in cats.values()),
        "status": "operational" if USE_AI else "limited"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
