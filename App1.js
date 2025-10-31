import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle, XCircle, FileText, TrendingUp, Clock, AlertTriangle, Brain, Shield, Upload, BookOpen, Trash2 } from 'lucide-react';

const PaymentComplianceSystem = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [payments, setPayments] = useState([]);
  const [rulebooks, setRulebooks] = useState({});
  const [rulesLibrary, setRulesLibrary] = useState([]);
  const [isUploadingRulebook, setIsUploadingRulebook] = useState(false);
  const [stats, setStats] = useState({
    totalPayments: 0,
    compliant: 0,
    nonCompliant: 0,
    stpRate: 0,
    avgInvestigationTime: '0 hours',
    aiAvgTime: '0 seconds',
    costSavings: 0,
    timesSaved: 0
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

  const checkBackendConnection = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/`);
      if (response.ok) {
        setBackendStatus('connected');
        setError(null);
      } else {
        setBackendStatus('error');
        setError('Backend not responding correctly');
      }
    } catch (err) {
      setBackendStatus('error');
      setError('Cannot connect to backend. Make sure the server is running on http://localhost:8000');
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
        setRulebooks(data);
      }
    } catch (err) {
      console.error('Error loading rulebooks:', err);
    }
  };

  const handleRulebookUpload = async (e, scheme) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!file.name.endsWith('.pdf')) {
      setError('Please upload a PDF file');
      return;
    }

    setIsUploadingRulebook(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${BACKEND_URL}/api/upload-rulebook?scheme=${scheme}`, {
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
      
      alert(`✅ Rulebook uploaded successfully!\n\nScheme: ${result.scheme}\nFile: ${result.filename}\nPages: ${result.pages}\nRules Extracted: ${result.rules_extracted}\n\nAI has extracted ${result.rules_extracted} rules to the library!`);
      
    } catch (err) {
      console.error('Error uploading rulebook:', err);
      setError(`Failed to upload rulebook: ${err.message}`);
    } finally {
      setIsUploadingRulebook(false);
    }
  };

  const handleDeleteRulebook = async (scheme) => {
    if (!window.confirm(`Delete ${scheme} rulebook?`)) return;

    try {
      const response = await fetch(`${BACKEND_URL}/api/rulebooks/${scheme}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        await loadRulebooks();
        alert(`Rulebook deleted: ${scheme}`);
      }
    } catch (err) {
      console.error('Error deleting rulebook:', err);
      setError(`Failed to delete rulebook: ${err.message}`);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsAnalyzing(true);
    setError(null);

    try {
      const fileContent = await file.text();
      const paymentData = JSON.parse(fileContent);

      const response = await fetch(`${BACKEND_URL}/api/validate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          payment_data: paymentData,
          scheme: paymentData.scheme || 'SEPA'
        })
      });

      if (!response.ok) {
        throw new Error(`Backend error: ${response.statusText}`);
      }

      const result = await response.json();
      setPayments(prev => [result, ...prev]);
      setAnalysisResult(result);
      setActiveTab('analysis');
      loadStatistics();

    } catch (err) {
      console.error('Error processing file:', err);
      setError(`Error: ${err.message}. Make sure the backend is running and the file is valid JSON.`);
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
                <strong>To fix:</strong> Run <code className="bg-red-100 px-2 py-1 rounded">python main.py</code> in the backend directory
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
              <p className="font-semibold text-green-900">Backend Connected ✓</p>
              <p className="text-sm text-green-700">
                AI Engine Ready • {Object.keys(rulebooks).length} PDF Rulebook(s) Uploaded
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-green-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">STP Rate</p>
              <p className="text-3xl font-bold text-gray-900">{stats.stpRate}%</p>
              <p className="text-xs text-green-600 mt-1">↑ 7.3% from manual</p>
            </div>
            <TrendingUp className="text-green-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Payments Analyzed</p>
              <p className="text-3xl font-bold text-gray-900">{payments.length}</p>
              <p className="text-xs text-blue-600 mt-1">This session</p>
            </div>
            <FileText className="text-blue-500" size={32} />
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6 border-l-4 border-purple-500">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Rules Library</p>
              <p className="text-3xl font-bold text-gray-900">{rulesLibrary.length}</p>
              <p className="text-xs text-purple-600 mt-1">AI-extracted rules</p>
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
              <p className="text-xs text-red-600 mt-1">Issues detected</p>
            </div>
            <AlertTriangle className="text-red-500" size={32} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg shadow-lg p-6 border-2 border-blue-200">
          <Brain size={40} className="text-blue-600 mb-3" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Validate Payment</h3>
          <p className="text-gray-600 mb-4">Upload a payment file for instant AI analysis</p>
          <label className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 cursor-pointer font-semibold">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileUpload} 
              accept=".json"
              disabled={isAnalyzing || backendStatus === 'error'}
            />
            <Upload size={20} />
            {isAnalyzing ? 'Analyzing...' : 'Upload Payment'}
          </label>
        </div>

        <div className="bg-gradient-to-br from-green-50 to-teal-50 rounded-lg shadow-lg p-6 border-2 border-green-200">
          <BookOpen size={40} className="text-green-600 mb-3" />
          <h3 className="text-xl font-bold text-gray-900 mb-2">Upload Rulebook</h3>
          <p className="text-gray-600 mb-4">Add PDF rulebooks for AI to learn from</p>
          <button
            onClick={() => setActiveTab('rulebooks')}
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-semibold"
          >
            <Upload size={20} />
            Manage Rulebooks
          </button>
        </div>
      </div>

      {payments.length > 0 && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">Recent Analyses</h3>
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
                      {payment.scheme} • {payment.amount} {payment.currency}
                      {payment.rulebookSource?.startsWith('uploaded-pdf') && (
                        <span className="ml-2 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">PDF Rules</span>
                      )}
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
                  View
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
        <h3 className="text-xl font-bold mb-2">📚 PDF Rulebook Management</h3>
        <p className="text-gray-600 mb-6">
          Upload payment scheme rulebooks (PDF format) and the AI will extract and learn the compliance rules automatically.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {['SEPA', 'SWIFT_MT103', 'CHAPS', 'SIX'].map(scheme => (
            <div key={scheme} className="border-2 border-dashed border-gray-300 rounded-lg p-6 hover:border-blue-400 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h4 className="font-semibold text-lg">{scheme}</h4>
                  <p className="text-sm text-gray-600">
                    {rulebooks[scheme] ? '✅ Rulebook Active' : '⚪ No rulebook uploaded'}
                  </p>
                </div>
                {rulebooks[scheme] && (
                  <button
                    onClick={() => handleDeleteRulebook(scheme)}
                    className="p-2 text-red-600 hover:bg-red-50 rounded"
                    title="Delete rulebook"
                  >
                    <Trash2 size={18} />
                  </button>
                )}
              </div>

              {rulebooks[scheme] ? (
                <div className="bg-green-50 p-3 rounded mb-3">
                  <p className="text-sm font-semibold text-green-900">{rulebooks[scheme].filename}</p>
                  <p className="text-xs text-green-700 mt-1">
                    {rulebooks[scheme].pages} pages • {(rulebooks[scheme].textLength / 1000).toFixed(1)}K chars
                  </p>
                  <p className="text-xs text-gray-600 mt-2">{rulebooks[scheme].summary}</p>
                </div>
              ) : null}

              <label className={`w-full inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg cursor-pointer font-semibold ${
                rulebooks[scheme] 
                  ? 'bg-yellow-600 text-white hover:bg-yellow-700' 
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf"
                  onChange={(e) => handleRulebookUpload(e, scheme)}
                  disabled={isUploadingRulebook}
                />
                <Upload size={16} />
                {isUploadingRulebook ? 'Uploading...' : (rulebooks[scheme] ? 'Update Rulebook' : 'Upload PDF')}
              </label>
            </div>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-4 mb-4">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {isUploadingRulebook && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <div className="flex items-center gap-4">
              <div className="animate-spin">
                <Brain size={32} className="text-blue-600" />
              </div>
              <div>
                <p className="font-semibold text-blue-900">Processing PDF Rulebook...</p>
                <p className="text-sm text-blue-700">Extracting text and generating AI summary</p>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg shadow p-6 border-2 border-purple-200">
        <h3 className="text-lg font-bold mb-3">🤖 How AI Learns from PDFs</h3>
        <div className="space-y-2 text-sm text-gray-700">
          <p>1️⃣ You upload a payment scheme rulebook (PDF format)</p>
          <p>2️⃣ System extracts all text content from the PDF</p>
          <p>3️⃣ AI (GPT-4) reads and understands the compliance rules</p>
          <p>4️⃣ When validating payments, AI references the uploaded rulebook</p>
          <p>5️⃣ Violations are detected based on actual PDF content, not hardcoded rules</p>
        </div>
        <div className="mt-4 p-3 bg-white rounded border border-purple-200">
          <p className="text-xs font-semibold text-purple-900">✨ This means you can add ANY payment scheme just by uploading its rulebook PDF!</p>
        </div>
      </div>
    </div>
  );

  const RulesLibraryView = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold">📚 Rules Library</h3>
            <p className="text-gray-600 mt-1">
              AI-extracted compliance rules from uploaded PDF rulebooks. Total: <strong>{rulesLibrary.length} rules</strong>
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
            <p className="text-sm text-gray-500 mt-2">Upload a PDF rulebook to extract rules automatically</p>
            <button
              onClick={() => setActiveTab('rulebooks')}
              className="mt-4 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Upload Rulebook
            </button>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(
              rulesLibrary.reduce((acc, rule) => {
                if (!acc[rule.scheme]) acc[rule.scheme] = [];
                acc[rule.scheme].push(rule);
                return acc;
              }, {})
            ).map(([scheme, rules]) => (
              <div key={scheme} className="border-2 border-gray-200 rounded-lg p-6 bg-gradient-to-br from-blue-50 to-purple-50">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="font-bold text-xl flex items-center gap-2">
                    <Shield size={24} className="text-blue-600" />
                    {scheme} Rules
                  </h4>
                  <span className="px-4 py-2 bg-blue-600 text-white rounded-full font-semibold">
                    {rules.length} Rules
                  </span>
                </div>
                
                <div className="space-y-4">
                  {rules.map((rule) => (
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
                            <span><strong>Version:</strong> {rule.version}</span>
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

                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span>🔍 Source: {rule.source}</span>
                          <span>•</span>
                          <span>📅 Added: {new Date(rule.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                  ))}
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
            <p className="text-sm text-gray-600 mb-1">Schemes Covered</p>
            <p className="text-3xl font-bold text-green-600">
              {new Set(rulesLibrary.map(r => r.scheme)).size}
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
          <h3 className="text-lg font-semibold">Upload & Validate Payment</h3>
          <label className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2 cursor-pointer">
            <input 
              type="file" 
              className="hidden" 
              onChange={handleFileUpload} 
              accept=".json"
              disabled={isAnalyzing || backendStatus === 'error'}
            />
            <Upload size={16} />
            {isAnalyzing ? 'Processing...' : 'Upload Payment File'}
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
                <p className="text-sm text-blue-700">Validating payment against rulebook rules</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {payments.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileText size={64} className="mx-auto text-gray-400 mb-4" />
          <p className="text-gray-600 text-lg mb-2">No payments uploaded yet</p>
          <p className="text-gray-500 text-sm">Upload a payment file to see AI analysis</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">ID</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Scheme</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {payments.map((payment, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{payment.id}</td>
                    <td className="px-6 py-4 text-sm text-gray-600">{payment.scheme}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{payment.amount} {payment.currency}</td>
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
                    <td className="px-6 py-4 text-xs">
                      {payment.rulebookSource?.startsWith('uploaded-pdf') ? (
                        <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded font-semibold">PDF Rules</span>
                      ) : (
                        <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded">Default</span>
                      )}
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
                        Analyze
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
          <p className="text-gray-500 text-sm">Upload a payment to see AI analysis</p>
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
            <h3 className="text-xl font-bold">AI Analysis: {payment.id}</h3>
            <div className="flex items-center gap-3">
              {payment.rulebookSource?.startsWith('uploaded-pdf') && (
                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold flex items-center gap-1">
                  <BookOpen size={14} />
                  Analyzed with PDF Rulebook
                </span>
              )}
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
              <p className="text-sm text-gray-600">Scheme</p>
              <p className="font-semibold">{payment.scheme}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Amount</p>
              <p className="font-semibold">{payment.amount} {payment.currency}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">AI Processing</p>
              <p className="font-semibold text-green-600">{payment.aiTime}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Confidence</p>
              <p className="font-semibold text-blue-600">{payment.confidence}%</p>
            </div>
          </div>
        </div>

        {payment.violations && payment.violations.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <AlertCircle className="text-red-600" />
              AI-Detected Violations ({payment.violations.length})
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
                      <p className="text-sm font-semibold text-gray-700 mb-1">📋 Rule Reference:</p>
                      <p className="text-sm text-gray-600 bg-white p-2 rounded">{violation.rule}</p>
                    </div>

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
                <h4 className="text-lg font-semibold text-green-900">All Checks Passed ✓</h4>
                <p className="text-green-700">This payment meets all {payment.scheme} requirements and is ready for processing.</p>
                <p className="text-sm text-green-600 mt-2">Validated in {payment.aiTime} using {payment.rulebookSource?.startsWith('uploaded-pdf') ? 'uploaded PDF rulebook' : 'default rules'}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg">
        <div className="container mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <Brain size={36} />
                Compliance AI Engine
              </h1>
              <p className="text-blue-100 mt-1">AI learns from PDF rulebooks • Real-time validation</p>
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
              <p className="text-xs text-blue-200 mt-1">{Object.keys(rulebooks).length} PDF Rulebook(s)</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white shadow-md">
        <div className="container mx-auto px-6">
          <div className="flex gap-1">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: TrendingUp },
              { id: 'rulebooks', label: 'PDF Rulebooks', icon: BookOpen },
              { id: 'rules', label: 'Rules Library', icon: Shield },
              { id: 'payments', label: 'Upload Payment', icon: Upload },
              { id: 'analysis', label: 'AI Analysis', icon: Brain }
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
              <p className="font-semibold">Powered by OpenAI GPT-4</p>
              <p className="text-sm text-gray-400">AI reads PDF rulebooks and validates payments intelligently</p>
            </div>
            <div className="text-right text-sm text-gray-400">
              <p>Hackathon 2024</p>
              <p>© Payment Compliance System</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PaymentComplianceSystem;
