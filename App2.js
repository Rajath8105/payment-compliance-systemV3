import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, XCircle, FileText, TrendingUp, AlertTriangle, Brain, Shield, Upload, BookOpen, Trash2, FileCode } from 'lucide-react';

const PACS008ComplianceSystem = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [payments, setPayments] = useState([]);
  const [rulebooks, setRulebooks] = useState({});
  const [rulesLibrary, setRulesLibrary] = useState([]);
  const [isUploadingRulebook, setIsUploadingRulebook] = useState(false);
  const [parsedXmlData, setParsedXmlData] = useState(null);
  const [stats, setStats] = useState({
    total_processed: 0,
    compliant: 0,
    non_compliant: 0,
    rules_library_size: 0
  });
  const [backendStatus, setBackendStatus] = useState('checking');
  const [error, setError] = useState(null);

  const BACKEND_URL = 'http://localhost:8000';

  useEffect(() => {
    checkBackendConnection();
    loadStatistics();
    loadRulebooks();
    loadRulesLibrary();
  }, []);

  const checkBackendConnection = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/`);
      if (response.ok) {
        setBackendStatus('connected');
        setError(null);
      } else {
        setBackendStatus('error');
        setError('Backend not responding');
      }
    } catch (err) {
      setBackendStatus('error');
      setError('Cannot connect to backend on http://localhost:8000');
    }
  };

  const loadStatistics = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/statistics`);
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      }
    } catch (err) {
      console.error('Error loading statistics:', err);
    }
  };

  const loadRulebooks = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rulebooks`);
      if (response.ok) {
        const data = await response.json();
        setRulebooks(data.details || {});
      }
    } catch (err) {
      console.error('Error loading rulebooks:', err);
    }
  };

  const loadRulesLibrary = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/rules`);
      if (response.ok) {
        const data = await response.json();
        setRulesLibrary(data.rules || []);
      }
    } catch (err) {
      console.error('Error loading rules library:', err);
    }
  };

  const handleRulebookUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.pdf') && !file.name.endsWith('.docx')) {
      setError('Please upload a PDF or DOCX file');
      return;
    }

    setIsUploadingRulebook(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${BACKEND_URL}/api/upload-rulebook?scheme=SEPA`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Upload failed');
      }

      const result = await response.json();
      
      await loadRulebooks();
      await loadRulesLibrary();
      
      alert(`✅ SEPA Rulebook Uploaded!\n\nFile: ${result.filename}\nPages: ${result.pages}\nRules Extracted: ${result.rules_extracted}\n\nAI can now validate PACS.008 payments using these rules!`);
      
    } catch (err) {
      console.error('Error uploading rulebook:', err);
      setError(`Failed to upload rulebook: ${err.message}`);
    } finally {
      setIsUploadingRulebook(false);
    }
  };

  const handleXmlUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.xml') && !file.name.endsWith('.txt')) {
      setError('Please upload an XML or TXT file');
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    setParsedXmlData(null);

    try {
      // First, parse the XML
      const formData = new FormData();
      formData.append('file', file);

      const parseResponse = await fetch(`${BACKEND_URL}/api/upload-payment`, {
        method: 'POST',
        body: formData
      });

      if (!parseResponse.ok) {
        const errorData = await parseResponse.json();
        throw new Error(errorData.detail || 'Failed to parse XML');
      }

      const parseResult = await parseResponse.json();
      const paymentData = parseResult.payment_data;
      setParsedXmlData(paymentData);

      // Then validate the payment
      const validateResponse = await fetch(`${BACKEND_URL}/api/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_data: paymentData,
          scheme: 'SEPA'
        })
      });

      if (!validateResponse.ok) {
        throw new Error('Validation failed');
      }

      const result = await validateResponse.json();
      setPayments(prev => [result, ...prev]);
      setAnalysisResult(result);
      setActiveTab('analysis');
      loadStatistics();

    } catch (err) {
      console.error('Error processing XML:', err);
      setError(`Error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const DashboardView = () => (
    <div className="space-y-6">
      {backendStatus === 'error' && (
        <div className="bg-red-50 border-2 border-red-300 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="text-red-600 flex-shrink-0 mt-1" size={24} />
            <div className="flex-1">
              <p className="font-semibold text-red-900">Backend Connection Error</p>
              <p className="text-sm text-red-700 mt-1">{error}</p>
              <p className="text-sm text-red-600 mt-2">
                <strong>To fix:</strong> Run <code className="bg-red-100 px-2 py-1 rounded">python main.py</code>
              </p>
            </div>
          </div>
        </div>
      )}

      {backendStatus === 'connected' && (
        <div className="bg-green-50 border-2 border-green-300 rounded-lg p-4">
          <div className="flex items-center gap-3">
            <CheckCircle className="text-green-600" size={24} />
            <div>
              <p className="font-semibold text-green-900">PACS.008 Validator Ready ✓</p>
              <p className="text-sm text-green-700">
                AI Engine Active • SEPA Compliance • {Object.keys(rulebooks).length} Rulebook(s) • {rulesLibrary.length} Rules Loaded
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Payments Validated</p>
              <p className="text-3xl font-bold text-gray-900">{payments.length}</p>
              <p className="text-xs text-blue-600 mt-1">This session</p>
            </div>
            <FileText className="text-blue-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Compliant</p>
              <p className="text-3xl font-bold text-gray-900">
                {payments.filter(p => p.status === 'compliant').length}
              </p>
              <p className="text-xs text-green-600 mt-1">Pass rate: {payments.length > 0 ? Math.round((payments.filter(p => p.status === 'compliant').length / payments.length) * 100) : 0}%</p>
            </div>
            <CheckCircle className="text-green-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">SEPA Rules</p>
              <p className="text-3xl font-bold text-gray-900">{rulesLibrary.length}</p>
              <p className="text-xs text-purple-600 mt-1">AI-extracted</p>
            </div>
            <Shield className="text-purple-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-red-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Non-Compliant</p>
              <p className="text-3xl font-bold text-gray-900">
                {payments.filter(p => p.status === 'non-compliant').length}
              </p>
              <p className="text-xs text-red-600 mt-1">Violations found</p>
            </div>
            <AlertTriangle className="text-red-500" size={32} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg shadow-lg p-6 border-2 border-blue-200">
          <FileCode size={40} className="text-blue-600 mb-3" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Upload PACS.008 XML</h3>
          <p className="text-gray-600 mb-4">Upload your PACS.008 payment XML for instant AI validation</p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer font-semibold">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleXmlUpload} 
              accept=".xml,.txt"
              disabled={isAnalyzing || backendStatus === 'error'}
            />
            <Upload size={20} />
            {isAnalyzing ? 'Analyzing...' : 'Upload XML Payment'}
          </label>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg shadow-lg p-6 border-2 border-green-200">
          <BookOpen size={40} className="text-green-600 mb-3" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Upload SEPA Rulebook</h3>
          <p className="text-gray-600 mb-4">Upload EPC SEPA rulebook PDF for AI to learn compliance rules</p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 cursor-pointer font-semibold">
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx"
              onChange={handleRulebookUpload}
              disabled={isUploadingRulebook}
            />
            <Upload size={20} />
            {isUploadingRulebook ? 'Processing...' : 'Upload Rulebook'}
          </label>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Validations</h3>
          <div className="space-y-3">
            {payments.slice(0, 5).map((payment, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100">
                <div className="flex items-center gap-3">
                  {payment.status === 'compliant' ? (
                    <CheckCircle className="text-green-600" size={20} />
                  ) : (
                    <XCircle className="text-red-600" size={20} />
                  )}
                  <div>
                    <p className="font-semibold">{payment.id}</p>
                    <p className="text-sm text-gray-600">
                      PACS.008 • {payment.amount} {payment.currency} • {payment.violations.length} violation(s)
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setAnalysisResult(payment);
                    setActiveTab('analysis');
                  }}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                >
                  View Details
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  const RulebooksView = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-xl font-bold mb-2">📚 SEPA PACS.008 Rulebook Management</h3>
        <p className="text-gray-600 mb-6">
          Upload the EPC SEPA Credit Transfer Scheme Rulebook (PDF/DOCX). The AI will extract compliance rules automatically.
        </p>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-400 transition-colors">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h4 className="font-semibold text-lg">SEPA PACS.008 Rulebook</h4>
              <p className="text-sm text-gray-600">
                {Object.keys(rulebooks).length > 0 ? '✅ Rulebook Active' : '⚪ No rulebook uploaded'}
              </p>
            </div>
          </div>

          {Object.keys(rulebooks).length > 0 && Object.values(rulebooks)[0] && (
            <div className="bg-green-50 p-3 rounded mb-3">
              <p className="text-sm font-semibold text-green-900">{Object.values(rulebooks)[0].filename}</p>
              <p className="text-xs text-green-700 mt-1">
                {Object.values(rulebooks)[0].pages} pages • Uploaded {new Date(Object.values(rulebooks)[0].upload_date).toLocaleDateString()}
              </p>
              <p className="text-xs text-gray-600 mt-2">{rulesLibrary.length} rules extracted and loaded into library</p>
            </div>
          )}

          <label className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg cursor-pointer font-semibold ${
            Object.keys(rulebooks).length > 0
              ? 'bg-yellow-600 text-white hover:bg-yellow-700' 
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}>
            <input
              type="file"
              className="hidden"
              accept=".pdf,.docx"
              onChange={handleRulebookUpload}
              disabled={isUploadingRulebook}
            />
            <Upload size={16} />
            {isUploadingRulebook ? 'Processing...' : (Object.keys(rulebooks).length > 0 ? 'Update Rulebook' : 'Upload PDF/DOCX')}
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 mt-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {isUploadingRulebook && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mt-4">
            <div className="flex items-center gap-4">
              <div className="animate-spin">
                <Brain size={32} className="text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-blue-900">Processing Rulebook...</p>
                <p className="text-sm text-blue-700">Extracting text and using AI to identify compliance rules</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg shadow p-6 border-2 border-purple-200">
        <h3 className="text-lg font-bold mb-3">🤖 How AI Learns SEPA Rules</h3>
        <div className="space-y-2 text-sm text-gray-700">
          <p>1️⃣ Upload EPC SEPA Credit Transfer Scheme Rulebook (EPC115-06)</p>
          <p>2️⃣ System extracts all text from the PDF/DOCX</p>
          <p>3️⃣ AI (GPT-4) reads and identifies compliance rules (AT-T001, AT-D001, etc.)</p>
          <p>4️⃣ Rules are stored in the library with severity, XML paths, and examples</p>
          <p>5️⃣ When validating PACS.008 XML, AI checks against extracted rules</p>
          <p>6️⃣ Violations are reported with specific rule references and fix suggestions</p>
        </div>
        <div className="mt-4 p-3 bg-white rounded border border-purple-200">
          <p className="text-xs font-semibold text-purple-900">✨ Current Status: {rulesLibrary.length} SEPA rules loaded and ready for validation!</p>
        </div>
      </div>
    </div>
  );

  const RulesLibraryView = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold">📚 SEPA PACS.008 Rules Library</h3>
            <p className="text-gray-600 mt-1">
              AI-extracted compliance rules from SEPA rulebook. Total: <strong>{rulesLibrary.length} rules</strong>
            </p>
          </div>
          <button
            onClick={loadRulesLibrary}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
          >
            <Upload size={16} />
            Refresh
          </button>
        </div>

        {rulesLibrary.length === 0 ? (
          <div className="text-center py-12">
            <BookOpen size={64} className="mx-auto text-gray-400 mb-4" />
            <p className="text-gray-600 text-lg mb-2">No rules in library yet</p>
            <p className="text-sm text-gray-500 mt-2">Upload the SEPA rulebook PDF to extract rules automatically</p>
            <button
              onClick={() => setActiveTab('rulebooks')}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Upload Rulebook
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {rulesLibrary.map((rule) => (
              <div key={rule.id} className={`border-l-4 p-4 rounded-lg bg-white shadow ${
                rule.severity === 'high' ? 'border-red-500' :
                rule.severity === 'medium' ? 'border-orange-500' :
                'border-yellow-500'
              }`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-lg text-gray-900">{rule.title}</span>
                      <span className={`px-2 py-1 rounded text-xs font-bold ${
                        rule.severity === 'high' ? 'bg-red-100 text-red-800' :
                        rule.severity === 'medium' ? 'bg-orange-100 text-orange-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {rule.severity.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-500 mb-2">
                      <span><strong>ID:</strong> {rule.id}</span>
                      <span><strong>Category:</strong> {rule.category}</span>
                      {rule.xmlPath && <span><strong>XML:</strong> {rule.xmlPath}</span>}
                    </div>
                  </div>
                </div>
                
                <div className="space-y-3">
                  <div className="bg-gray-50 p-3 rounded">
                    <p className="text-sm font-semibold text-gray-700 mb-1">📖 Description:</p>
                    <p className="text-sm text-gray-700">{rule.description}</p>
                  </div>
                  
                  {rule.example && (
                    <div className="bg-blue-50 p-3 rounded border border-blue-200">
                      <p className="text-sm font-semibold text-blue-900 mb-1">💡 Example Violation:</p>
                      <p className="text-sm text-blue-800">{rule.example}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {rulesLibrary.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">Total Rules</p>
            <p className="text-3xl font-bold text-blue-600">{rulesLibrary.length}</p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">High Severity</p>
            <p className="text-3xl font-bold text-red-600">
              {rulesLibrary.filter(r => r.severity === 'high').length}
            </p>
          </div>
          <div className="bg-white rounded-lg shadow p-6">
            <p className="text-sm text-gray-600 mb-1">Categories</p>
            <p className="text-3xl font-bold text-green-600">
              {new Set(rulesLibrary.map(r => r.category)).size}
            </p>
          </div>
        </div>
      )}
    </div>
  );

  const PaymentsView = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-semibold">Upload PACS.008 XML Payment</h3>
          <label className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 cursor-pointer">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleXmlUpload} 
              accept=".xml,.txt"
              disabled={isAnalyzing || backendStatus === 'error'}
            />
            <Upload size={16} />
            {isAnalyzing ? 'Processing...' : 'Upload XML File'}
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {isAnalyzing && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
            <div className="flex items-center gap-4">
              <div className="animate-spin">
                <Brain size={32} className="text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-blue-900">AI Analysis in Progress...</p>
                <p className="text-sm text-blue-700">Parsing XML and validating against SEPA rules</p>
              </div>
            </div>
          </div>
        )}

        {parsedXmlData && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="font-semibold text-green-900 mb-2">✅ XML Parsed Successfully</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div>
                <p className="text-gray-600">Message ID</p>
                <p className="font-semibold">{parsedXmlData.message_id}</p>
              </div>
              <div>
                <p className="text-gray-600">Amount</p>
                <p className="font-semibold">{parsedXmlData.amount} {parsedXmlData.currency}</p>
              </div>
              <div>
                <p className="text-gray-600">Debtor</p>
                <p className="font-semibold">{parsedXmlData.debtor_name}</p>
              </div>
              <div>
                <p className="text-gray-600">Creditor</p>
                <p className="font-semibold">{parsedXmlData.creditor_name}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {payments.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileCode size={64} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 text-lg mb-2">No PACS.008 payments uploaded yet</p>
          <p className="text-gray-500 text-sm">Upload a PACS.008 XML file to see AI validation</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Transaction ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Debtor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Creditor</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Violations</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payments.map((payment, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{payment.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{payment.amount} {payment.currency}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{payment.sender?.substring(0, 20)}...</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{payment.receiver?.substring(0, 20)}...</td>
                    <td className="px-6 py-4">
                      {payment.status === 'compliant' ? (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800 flex items-center gap-1 w-fit">
                          <CheckCircle size={12} />
                          Compliant
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800 flex items-center gap-1 w-fit">
                          <XCircle size={12} />
                          Non-Compliant
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded font-semibold ${
                        payment.violations.length === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                      }`}>
                        {payment.violations.length}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={() => {
                          setAnalysisResult(payment);
                          setActiveTab('analysis');
                        }}
                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 flex items-center gap-1"
                      >
                        <Brain size={12} />
                        View Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );

  const AnalysisView = () => {
    const payment = analysisResult;
    
    if (!payment) {
      return (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <Brain size={64} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 text-lg mb-2">No payment selected</p>
          <p className="text-gray-500 text-sm">Upload a PACS.008 XML to see AI analysis</p>
          <button
            onClick={() => setActiveTab('payments')}
            className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Upload Payment
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold">PACS.008 Compliance Report: {payment.id}</h3>
            <div className="flex items-center gap-3">
              {payment.status === 'compliant' ? (
                <div className="flex items-center gap-2 px-4 py-2 bg-green-100 rounded-lg">
                  <CheckCircle className="text-green-600" size={24} />
                  <span className="font-semibold text-green-800">COMPLIANT ✓</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="text-red-600" size={24} />
                  <span className="font-semibold text-red-800">NON-COMPLIANT ✗</span>
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div>
              <p className="text-sm text-gray-600">Message Type</p>
              <p className="font-semibold">PACS.008</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Amount</p>
              <p className="font-semibold">{payment.amount} {payment.currency}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">AI Processing Time</p>
              <p className="font-semibold text-green-600">{payment.aiTime}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Confidence</p>
              <p className="font-semibold text-blue-600">{payment.confidence}%</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t">
            <div>
              <p className="text-sm text-gray-600">Debtor (Originator)</p>
              <p className="font-semibold text-sm">{payment.sender || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Creditor (Beneficiary)</p>
              <p className="font-semibold text-sm">{payment.receiver || 'N/A'}</p>
            </div>
          </div>
        </div>

        {payment.violations && payment.violations.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertCircle className="text-red-600" />
              SEPA Compliance Violations ({payment.violations.length})
            </h3>

            <div className="space-y-4">
              {payment.violations.map((violation, idx) => (
                <div key={idx} className={`border-l-4 rounded-lg p-4 ${
                  violation.severity === 'high' ? 'border-red-500 bg-red-50' :
                  violation.severity === 'medium' ? 'border-orange-500 bg-orange-50' :
                  'border-yellow-500 bg-yellow-50'
                }`}>
                  <div className="flex items-start justify-between mb-2">
                    <h4 className="font-semibold text-gray-900">Violation #{idx + 1}</h4>
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      violation.severity === 'high' ? 'bg-red-200 text-red-800' :
                      violation.severity === 'medium' ? 'bg-orange-200 text-orange-800' :
                      'bg-yellow-200 text-yellow-800'
                    }`}>
                      {violation.severity.toUpperCase()}
                    </span>
                  </div>

                  <div className="space-y-3 mt-4">
                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">📋 SEPA Rule Reference:</p>
                      <p className="text-sm text-gray-600 bg-white p-2 rounded">{violation.rule}</p>
                    </div>

                    {violation.xmlPath && (
                      <div>
                        <p className="text-sm font-semibold text-gray-700 mb-1">📍 XML Path:</p>
                        <p className="text-xs text-gray-600 bg-white p-2 rounded font-mono">{violation.xmlPath}</p>
                      </div>
                    )}

                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">⚠️ Issue Detected:</p>
                      <p className="text-sm text-gray-600 bg-white p-2 rounded">{violation.issue}</p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-gray-700 mb-1">💥 Business Impact:</p>
                      <p className="text-sm text-gray-600 bg-white p-2 rounded">{violation.impact}</p>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-green-700 mb-1">✅ AI Recommendation:</p>
                      <p className="text-sm text-gray-600 bg-green-50 p-2 rounded border border-green-200">{violation.suggestion}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {payment.status === 'compliant' && (
          <div className="bg-green-50 border-2 border-green-200 rounded-lg p-6">
            <div className="flex items-center gap-4">
              <Shield size={48} className="text-green-600" />
              <div>
                <h4 className="text-lg font-semibold text-green-900">All SEPA Checks Passed ✓</h4>
                <p className="text-green-700">This PACS.008 payment meets all SEPA Credit Transfer requirements and is ready for processing.</p>
                <p className="text-sm text-green-600 mt-2">
                  Validated in {payment.aiTime} using {payment.aiPowered ? 'AI-powered analysis' : 'rule-based validation'} 
                  {payment.rulebookSource.includes('uploaded') ? ' with your uploaded rulebook' : ' with default SEPA rules'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h4 className="font-semibold text-gray-900 mb-3">📊 Validation Summary</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-3 rounded">
              <p className="text-xs text-gray-600">Total Checks</p>
              <p className="text-2xl font-bold text-gray-900">{payment.violations.length === 0 ? '✓' : payment.violations.length + ' issues'}</p>
            </div>
            <div className="bg-white p-3 rounded">
              <p className="text-xs text-gray-600">High Severity</p>
              <p className="text-2xl font-bold text-red-600">
                {payment.violations.filter(v => v.severity === 'high').length}
              </p>
            </div>
            <div className="bg-white p-3 rounded">
              <p className="text-xs text-gray-600">Medium Severity</p>
              <p className="text-2xl font-bold text-orange-600">
                {payment.violations.filter(v => v.severity === 'medium').length}
              </p>
            </div>
            <div className="bg-white p-3 rounded">
              <p className="text-xs text-gray-600">Low Severity</p>
              <p className="text-2xl font-bold text-yellow-600">
                {payment.violations.filter(v => v.severity === 'low').length}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-indigo-50">
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Brain size={36} />
                PACS.008 Compliance AI
              </h1>
              <p className="text-blue-100 mt-1">SEPA Credit Transfer Validation • Real-time AI Analysis</p>
            </div>
            <div className="text-right">
              <div className={`px-3 py-1 rounded-full text-sm font-semibold ${
                backendStatus === 'connected' ? 'bg-green-400 text-green-900' :
                backendStatus === 'error' ? 'bg-red-400 text-red-900' :
                'bg-yellow-400 text-yellow-900'
              }`}>
                {backendStatus === 'connected' ? '● Connected' :
                 backendStatus === 'error' ? '● Disconnected' :
                 '● Connecting...'}
              </div>
              <p className="text-xs text-blue-200 mt-1">{rulesLibrary.length} SEPA Rules Loaded</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow-md">
        <div className="container mx-auto px-6">
          <div className="flex gap-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
              { id: 'rulebooks', label: 'SEPA Rulebook', icon: BookOpen },
              { id: 'rules', label: 'Rules Library', icon: Shield },
              { id: 'payments', label: 'Upload XML', icon: FileCode },
              { id: 'analysis', label: 'Analysis Report', icon: Brain }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 font-semibold transition-all ${
                  activeTab === tab.id
                    ? 'text-blue-600 border-b-4 border-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="container mx-auto px-6 py-8">
        {activeTab === 'dashboard' && <DashboardView />}
        {activeTab === 'rulebooks' && <RulebooksView />}
        {activeTab === 'rules' && <RulesLibraryView />}
        {activeTab === 'payments' && <PaymentsView />}
        {activeTab === 'analysis' && <AnalysisView />}
      </div>

      <div className="bg-gray-800 text-white mt-12">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold">PACS.008 SEPA Compliance Validator</p>
              <p className="text-sm text-gray-400">Powered by AI • Validates against EPC SEPA Credit Transfer Scheme Rulebook</p>
            </div>
            <div className="text-right text-sm text-gray-400">
              <p>ISO 20022 PACS.008.001.08</p>
              <p>© 2024 Payment Compliance System</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PACS008ComplianceSystem;
