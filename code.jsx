import React, { useState, useRef, useEffect } from 'react';
import { Upload, Send, FileText, Mic, Link, Image, Loader2, Check, X, Brain } from 'lucide-react';

const SecondBrainApp = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [activeTab, setActiveTab] = useState('chat');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const stored = await window.storage.list('doc:');
      if (stored && stored.keys) {
        const docs = await Promise.all(
          stored.keys.map(async key => {
            try {
              const result = await window.storage.get(key);
              return result ? JSON.parse(result.value) : null;
            } catch {
              return null;
            }
          })
        );
        setDocuments(docs.filter(Boolean));
      }
    } catch (error) {
      console.error('Error loading documents:', error);
    }
  };

  const processDocument = async (file, type) => {
    setUploading(true);
    try {
      const content = await readFileContent(file, type);
      const doc = {
        id: `doc_${Date.now()}`,
        name: file.name,
        type,
        content,
        timestamp: new Date().toISOString(),
        size: file.size
      };

      await window.storage.set(`doc:${doc.id}`, JSON.stringify(doc));
      setDocuments(prev => [...prev, doc]);
      
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✓ Successfully processed ${file.name} (${type})`
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✗ Error processing ${file.name}: ${error.message}`
      }]);
    } finally {
      setUploading(false);
    }
  };

  const readFileContent = (file, type) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target.result;
        if (type === 'audio') {
          resolve(`[Audio file: ${file.name}. In production, this would be transcribed using Whisper API]`);
        } else if (type === 'image') {
          resolve(`[Image: ${file.name}. In production, this would be analyzed using Vision API]`);
        } else {
          resolve(content);
        }
      };
      reader.onerror = reject;
      
      if (type === 'audio' || type === 'image') {
        reader.readAsDataURL(file);
      } else {
        reader.readAsText(file);
      }
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    const typeMap = {
      'mp3': 'audio',
      'm4a': 'audio',
      'wav': 'audio',
      'pdf': 'document',
      'md': 'document',
      'txt': 'text',
      'jpg': 'image',
      'jpeg': 'image',
      'png': 'image'
    };

    const type = typeMap[ext] || 'text';
    await processDocument(file, type);
  };

  const handleWebUrl = async () => {
    const url = prompt('Enter URL to process:');
    if (!url) return;

    setUploading(true);
    try {
      const doc = {
        id: `doc_${Date.now()}`,
        name: url,
        type: 'web',
        content: `[Web content from ${url}. In production, this would be scraped and processed]`,
        timestamp: new Date().toISOString(),
        url
      };

      await window.storage.set(`doc:${doc.id}`, JSON.stringify(doc));
      setDocuments(prev => [...prev, doc]);
      
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✓ Successfully processed web content from ${url}`
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'system',
        content: `✗ Error processing URL: ${error.message}`
      }]);
    } finally {
      setUploading(false);
    }
  };

  const searchDocuments = (query) => {
    const lowerQuery = query.toLowerCase();
    const timePatterns = [
      { regex: /last\s+(week|month|year)/i, days: { week: 7, month: 30, year: 365 } },
      { regex: /yesterday/i, days: 1 },
      { regex: /today/i, days: 0 }
    ];

    let timeFilter = null;
    for (const pattern of timePatterns) {
      const match = query.match(pattern.regex);
      if (match) {
        const days = typeof pattern.days === 'object' ? pattern.days[match[1]] : pattern.days;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        timeFilter = cutoff;
        break;
      }
    }

    return documents
      .filter(doc => {
        if (timeFilter && new Date(doc.timestamp) < timeFilter) return false;
        return doc.content.toLowerCase().includes(lowerQuery) ||
               doc.name.toLowerCase().includes(lowerQuery);
      })
      .map(doc => ({
        ...doc,
        relevance: (doc.content.toLowerCase().match(new RegExp(lowerQuery, 'g')) || []).length
      }))
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, 3);
  };

  const generateResponse = async (query, context) => {
    const systemPrompt = `You are a helpful AI assistant with access to the user's personal knowledge base. Use the provided context to answer questions accurately and concisely.

Context from knowledge base:
${context.map((doc, i) => `
[Document ${i + 1}: ${doc.name}]
${doc.content.substring(0, 500)}...
`).join('\n')}

Based on this context, answer the user's question. If the context doesn't contain relevant information, say so.`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1000,
          messages: [
            { role: 'user', content: systemPrompt },
            { role: 'assistant', content: 'I understand. I will use the provided context to answer questions.' },
            { role: 'user', content: query }
          ],
        })
      });

      const data = await response.json();
      return data.content[0].text;
    } catch (error) {
      return `I found ${context.length} relevant document(s) about "${query}". ${context.length > 0 ? `The most relevant is "${context[0].name}".` : 'Try uploading more documents to expand my knowledge.'}`;
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = { role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setLoading(true);

    try {
      const relevantDocs = searchDocuments(input);
      const response = await generateResponse(input, relevantDocs);
      
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: response,
        sources: relevantDocs.map(d => d.name)
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'I apologize, but I encountered an error processing your query. Please try again.'
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearAllData = async () => {
    if (confirm('Are you sure you want to delete all documents and chat history?')) {
      try {
        const stored = await window.storage.list('doc:');
        if (stored && stored.keys) {
          await Promise.all(stored.keys.map(key => window.storage.delete(key)));
        }
        setDocuments([]);
        setMessages([]);
      } catch (error) {
        console.error('Error clearing data:', error);
      }
    }
  };

  return (
    <div className="flex h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white">
      {/* Sidebar */}
      <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
        <div className="p-6 border-b border-gray-700">
          <div className="flex items-center gap-3 mb-6">
            <Brain className="w-8 h-8 text-blue-400" />
            <div>
              <h1 className="text-xl font-bold">Second Brain</h1>
              <p className="text-xs text-gray-400">Your AI Companion</p>
            </div>
          </div>
          
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                activeTab === 'chat' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('docs')}
              className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition ${
                activeTab === 'docs' ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              Documents
            </button>
          </div>

          <div className="space-y-2">
            <label className="flex items-center justify-center gap-2 p-3 bg-blue-600 hover:bg-blue-700 rounded-lg cursor-pointer transition">
              <Upload className="w-4 h-4" />
              <span className="text-sm font-medium">Upload File</span>
              <input
                type="file"
                onChange={handleFileUpload}
                className="hidden"
                accept=".pdf,.md,.txt,.mp3,.m4a,.wav,.jpg,.jpeg,.png"
              />
            </label>
            
            <button
              onClick={handleWebUrl}
              className="w-full flex items-center justify-center gap-2 p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition"
            >
              <Link className="w-4 h-4" />
              <span className="text-sm font-medium">Add URL</span>
            </button>

            <button
              onClick={clearAllData}
              className="w-full flex items-center justify-center gap-2 p-3 bg-red-600 hover:bg-red-700 rounded-lg transition"
            >
              <X className="w-4 h-4" />
              <span className="text-sm font-medium">Clear All</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">
            Knowledge Base ({documents.length})
          </h3>
          <div className="space-y-2">
            {documents.map(doc => (
              <div key={doc.id} className="p-3 bg-gray-700 rounded-lg">
                <div className="flex items-start gap-2">
                  {doc.type === 'audio' && <Mic className="w-4 h-4 text-purple-400 mt-1" />}
                  {doc.type === 'document' && <FileText className="w-4 h-4 text-blue-400 mt-1" />}
                  {doc.type === 'web' && <Link className="w-4 h-4 text-green-400 mt-1" />}
                  {doc.type === 'image' && <Image className="w-4 h-4 text-yellow-400 mt-1" />}
                  {doc.type === 'text' && <FileText className="w-4 h-4 text-gray-400 mt-1" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(doc.timestamp).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeTab === 'chat' ? (
          <>
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center max-w-md">
                    <Brain className="w-16 h-16 text-blue-400 mx-auto mb-4" />
                    <h2 className="text-2xl font-bold mb-2">Welcome to Your Second Brain</h2>
                    <p className="text-gray-400">
                      Upload documents, audio, or web content, then ask me anything about your knowledge base.
                    </p>
                  </div>
                </div>
              ) : (
                messages.map((msg, i) => (
                  <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-2xl rounded-lg p-4 ${
                      msg.role === 'user' ? 'bg-blue-600' :
                      msg.role === 'system' ? 'bg-gray-700 text-gray-300 text-sm' :
                      'bg-gray-700'
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-gray-600">
                          <p className="text-xs text-gray-400 mb-1">Sources:</p>
                          {msg.sources.map((src, j) => (
                            <span key={j} className="inline-block text-xs bg-gray-600 px-2 py-1 rounded mr-2 mb-1">
                              {src}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
              {loading && (
                <div className="flex justify-start">
                  <div className="bg-gray-700 rounded-lg p-4">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="border-t border-gray-700 p-4">
              <div className="max-w-4xl mx-auto">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder="Ask anything about your knowledge base..."
                    disabled={loading || uploading}
                    className="flex-1 bg-gray-700 text-white px-4 py-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() || loading || uploading}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 px-6 py-3 rounded-lg transition"
                  >
                    {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto p-6">
            <h2 className="text-2xl font-bold mb-6">Document Library</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map(doc => (
                <div key={doc.id} className="bg-gray-700 rounded-lg p-4">
                  <div className="flex items-start gap-3 mb-3">
                    {doc.type === 'audio' && <Mic className="w-6 h-6 text-purple-400" />}
                    {doc.type === 'document' && <FileText className="w-6 h-6 text-blue-400" />}
                    {doc.type === 'web' && <Link className="w-6 h-6 text-green-400" />}
                    {doc.type === 'image' && <Image className="w-6 h-6 text-yellow-400" />}
                    {doc.type === 'text' && <FileText className="w-6 h-6 text-gray-400" />}
                    <div className="flex-1">
                      <h3 className="font-medium mb-1">{doc.name}</h3>
                      <p className="text-xs text-gray-400 uppercase">{doc.type}</p>
                    </div>
                  </div>
                  <p className="text-sm text-gray-300 mb-2 line-clamp-3">
                    {doc.content.substring(0, 150)}...
                  </p>
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>{new Date(doc.timestamp).toLocaleString()}</span>
                    {doc.size && <span>{(doc.size / 1024).toFixed(1)} KB</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SecondBrainApp;
