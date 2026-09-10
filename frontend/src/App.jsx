import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import {
  Upload, AlertCircle, Loader2, CheckCircle2, XCircle, FileText,
  Download, Search, Shield, ShoppingBag, BarChart3, FolderArchive,
  LogOut, UserCheck, KeyRound, User, Lock, Mail, RefreshCw, Trash2,
  ExternalLink, Calendar, Filter, Sparkles, Camera, ArrowLeft,
  ChevronDown, ChevronUp, Check, Info, Image as ImageIcon
} from 'lucide-react';
import './App.css';

const API = 'http://localhost:5000';

axios.defaults.baseURL = API;
axios.defaults.withCredentials = true;

/* ============================================================
   Expanded Consumer Preferences Metadata
   ============================================================ */
const PREFERENCE_GROUPS = [
  {
    id: 'dietary',
    title: 'Dietary Type',
    description: 'Religious, philosophical, and personal dietary patterns',
    options: [
      { id: 'vegetarian', label: 'Vegetarian', desc: 'No meat, poultry, fish, or animal rennet' },
      { id: 'vegan', label: 'Vegan', desc: '100% plant-based, no dairy, eggs, or honey' },
      { id: 'eggetarian', label: 'Eggetarian', desc: 'Vegetarian plus eggs permitted' },
      { id: 'jain', label: 'Jain Compatible', desc: 'Strict vegetarian; no root vegetables (onion/garlic/potato)' },
      { id: 'halal', label: 'Halal Compliant', desc: 'No pork, alcohol, or non-halal animal additives' },
      { id: 'kosher', label: 'Kosher Compatible', desc: 'No pork, shellfish, or meat/dairy mixing' },
      { id: 'pescatarian', label: 'Pescatarian', desc: 'Vegetarian plus fish/seafood permitted' }
    ]
  },
  {
    id: 'allergies',
    title: 'Allergies & Intolerances',
    description: 'Immune reactions and digestive sensitivities',
    options: [
      { id: 'milk', label: 'Milk / Dairy Allergy', desc: 'Allergic reaction to dairy proteins (casein/whey)' },
      { id: 'lactose_intolerance', label: 'Lactose Intolerance', desc: 'Enzymatic deficiency sensitivity to milk sugars' },
      { id: 'eggs', label: 'Egg Allergy', desc: 'Allergic reaction to egg white/yolk proteins' },
      { id: 'peanuts', label: 'Peanuts / Groundnuts', desc: 'Severe legume allergen' },
      { id: 'tree_nuts', label: 'Tree Nuts', desc: 'Almonds, cashews, walnuts, pistachios, etc.' },
      { id: 'soy', label: 'Soy / Soya', desc: 'Soybean proteins and derivatives' },
      { id: 'wheat', label: 'Wheat Allergy', desc: 'Classic IgE wheat allergy' },
      { id: 'gluten_celiac', label: 'Gluten / Celiac', desc: 'Autoimmune reaction to wheat, barley, rye gluten' },
      { id: 'fish', label: 'Fish Allergy', desc: 'Finned fish allergy' },
      { id: 'shellfish', label: 'Shellfish / Crustaceans', desc: 'Shrimp, prawns, crab, mollusks' },
      { id: 'sesame', label: 'Sesame / Til', desc: 'Sesame seeds and gingelly oil' },
      { id: 'mustard', label: 'Mustard / Sarson', desc: 'Mustard seeds and mustard flour' },
      { id: 'sulphites', label: 'Sulphites Sensitivity', desc: 'Sulphur dioxide preservatives (E220-E228)' }
    ]
  },
  {
    id: 'health',
    title: 'Health Goals & Nutrition',
    description: 'Nutritional targets evaluated against nutrition facts panel',
    options: [
      { id: 'high_calorie_avoid', label: 'Avoid High Calorie', desc: 'Flags products with >400 kcal per serving' },
      { id: 'low_calorie_prefer', label: 'Prefer Low Calorie', desc: 'Targeting lighter foods (<=120 kcal)' },
      { id: 'diabetic_friendly_low_sugar', label: 'Diabetic-Friendly / Low Sugar', desc: 'Sugar content <=5g per 100g' },
      { id: 'sugar_free', label: 'Sugar-Free', desc: 'Zero or negligible declared sugar' },
      { id: 'low_sodium', label: 'Low Sodium', desc: 'Sodium <=140mg per serving (heart friendly)' },
      { id: 'low_fat', label: 'Low Fat', desc: 'Total fat <=3g per 100g' },
      { id: 'high_protein', label: 'High Protein', desc: 'Protein >=10g per serving' },
      { id: 'high_fiber', label: 'High Fiber', desc: 'Dietary fiber >=6g per 100g' },
      { id: 'low_carb_keto', label: 'Low Carb / Keto-Friendly', desc: 'Net carbohydrates <=5g per serving' }
    ]
  },
  {
    id: 'clean_label',
    title: 'Clean Label & Additives',
    description: 'Ingredient purity and processing preferences',
    options: [
      { id: 'organic_preferred', label: 'Organic Certified', desc: 'Certified organic ingredients (Jaivik Bharat / USDA)' },
      { id: 'no_artificial_colors_flavors', label: 'No Artificial Colors / Flavors', desc: 'No synthetic food dyes or flavorings' },
      { id: 'no_preservatives', label: 'No Chemical Preservatives', desc: 'Free of synthetic class-II preservatives' },
      { id: 'no_msg', label: 'No Added MSG', desc: 'Free of monosodium glutamate (E621)' },
      { id: 'non_gmo', label: 'Non-GMO Verified', desc: 'No genetically modified organisms' }
    ]
  }
];

/* ============================================================
   Root Component (Officer Portal is Default View)
   ============================================================ */
export default function App() {
  // Feature 4: Default to 'officer' on site load
  const [mode, setMode] = useState('officer');
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('drishti_user');
    const token = localStorage.getItem('drishti_token');
    if (saved && token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      try { return JSON.parse(saved); } catch (e) { return null; }
    }
    return null;
  });

  const handleLogin = (userData, token) => {
    setUser(userData);
    localStorage.setItem('drishti_user', JSON.stringify(userData));
    localStorage.setItem('drishti_token', token);
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  };

  const handleLogout = async () => {
    try { await axios.post('/api/auth/logout'); } catch (e) {}
    setUser(null);
    localStorage.removeItem('drishti_user');
    localStorage.removeItem('drishti_token');
    delete axios.defaults.headers.common['Authorization'];
  };

  return (
    <div className="app-wrapper">
      {/* Top Main Navbar */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="logo-icon"><Shield size={18} /></div>
          <span>DrishtiScan</span>
          <span className="brand-subtitle">Metrology Food Scanner</span>
        </div>

        <div className="mode-switcher">
          <button
            id="officer-portal-mode-btn"
            className={`mode-btn ${mode === 'officer' ? 'active' : ''}`}
            onClick={() => setMode('officer')}
          >
            <Shield size={14} /> Officer Portal
          </button>
          <button
            id="consumer-view-mode-btn"
            className={`mode-btn ${mode === 'consumer' ? 'active' : ''}`}
            onClick={() => setMode('consumer')}
          >
            <ShoppingBag size={14} /> Consumer View
          </button>
        </div>
      </nav>

      {/* Main App Content */}
      <main className="main-content">
        {mode === 'consumer' ? (
          <ConsumerView onSwitchToOfficer={() => setMode('officer')} />
        ) : (
          <OfficerPortal
            user={user}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onSwitchToConsumer={() => setMode('consumer')}
          />
        )}
      </main>

      <footer className="app-footer">
        DrishtiScan · Legal Metrology (Packaged Commodities) Rules, 2011 · Multi-Angle Inspection Engine
      </footer>
    </div>
  );
}

/* ============================================================
   CONSUMER VIEW (Multi-Photo, Grouped Preferences)
   ============================================================ */
function ConsumerView({ onSwitchToOfficer }) {
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // Grouped preferences state
  const [preferences, setPreferences] = useState({});
  const [openGroup, setOpenGroup] = useState('dietary');

  const handleSelectFiles = (newFiles) => {
    const valid = Array.from(newFiles).filter(f => f.type.startsWith('image/'));
    if (result) {
      setFiles(valid);
      setResult(null);
      setError(null);
    } else {
      setFiles(prev => [...prev, ...valid]);
      setError(null);
    }
  };

  const handleRemoveFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleClear = () => {
    setFiles([]);
    setResult(null);
    setError(null);
  };

  const togglePreference = (prefId) => {
    setPreferences(prev => ({
      ...prev,
      [prefId]: !prev[prefId]
    }));
  };

  const handleScan = async () => {
    if (files.length === 0) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    files.forEach(f => {
      form.append('images', f);
    });
    form.append('preferences', JSON.stringify(preferences));

    try {
      const res = await axios.post('/api/consumer/scan', form);
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Scan processing failed. Please verify OCR service.');
    } finally {
      setLoading(false);
    }
  };

  const fields = result?.extractedFields || {};
  const prefResult = result?.preferences || {};
  const activePrefCount = Object.values(preferences).filter(Boolean).length;

  const isAiAssisted = (fieldKey) => {
    if (!fieldKey || !result) return false;
    const ef = result.extractedFields || {};
    if (ef.geminiMetadata?.fallback?.fieldsRecovered?.includes(fieldKey)) return true;
    const declKey = fieldKey.split('.')[0];
    const decl = ef.declarations?.[declKey];
    if (!decl) return false;
    if (decl.aiAssisted === true || decl.source === 'gemini_fallback') return true;
    if (decl.status === 'unverified' || decl.needsReview === true) return true;
    if (typeof decl.confidence === 'number' && decl.confidence < 0.65) return true;
    if (fieldKey.includes('.') && (decl[fieldKey.split('.')[1]]?.aiAssisted || decl[fieldKey.split('.')[1]]?.needsReview)) return true;
    return false;
  };

  return (
    <div>
      {/* Navigation Header */}
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 className="section-title"><ShoppingBag size={24} color="#3b82f6" /> Consumer Product Scanner</h1>
          <p className="section-desc">Upload multiple package photos (front, back, nutritional table) to verify price, expiry, and personal suitability.</p>
        </div>

        {result && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button className="btn btn-secondary" onClick={handleClear}>
              <ArrowLeft size={14} /> Back to Scanner
            </button>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleClear}>
              <RefreshCw size={14} /> Scan Another Product
            </button>
          </div>
        )}
      </div>

      {/* Three guarded branches for ConsumerView */}
      {loading && (
        <div className="inspection-progress-card">
          <div className="progress-header">
            <div className="progress-title-text">Packaging Inspection Active</div>
            <div className="file-count-pill">
              <Loader2 className="spinner" size={13} /> Analysing {files.length} photo angle{files.length !== 1 ? 's' : ''}
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-2)', margin: '0 0 1rem 0' }}>
            Reading package declarations and verifying nutritional details against your preferences. This typically takes 10–25 seconds.
          </p>

          <div className="progress-pipeline">
            <div className="progress-stage active">
              <CheckCircle2 size={16} color="var(--accent)" />
              <span>Step 1: Reading packaging panels &amp; extracting raw declarations</span>
            </div>
            <div className="progress-stage active">
              <Loader2 className="spinner" size={16} color="var(--accent)" />
              <span>Step 2: Checking mandatory declarations, dates, and pricing</span>
            </div>
            <div className="progress-stage">
              <Sparkles size={16} color="var(--ink-3)" />
              <span>Step 3: Cross-checking ingredients against personal suitability</span>
            </div>
          </div>
        </div>
      )}

      {!loading && !result && (
        <div className="consumer-intake-layout">
          {/* Left Column: Evidence Acquisition */}
          <div className="intake-col evidence-col">
            <div className="card">
              <div className="card-title">
                <span>1. Package Label Photos</span>
              </div>

              {/* Capture Guidance Banner */}
              <div className="capture-guidance-banner">
                <Sparkles size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <strong>Tip for best results:</strong> Avoid direct flash glare • Hold camera steady • Capture front, back, and nutritional panels.
                </div>
              </div>

              {/* Multi-Photo Uploader Component */}
              <MultiImageUploader
                files={files}
                onSelect={handleSelectFiles}
                onRemove={handleRemoveFile}
                onClearAll={handleClear}
                disabled={loading}
              />
            </div>
          </div>

          {/* Right Column: Personal Suitability & Trigger Action */}
          <div className="intake-col preferences-col">
            <div className="card preferences-card">
              <div className="card-title">
                <span>2. Personal Suitability{activePrefCount > 0 ? ` (${activePrefCount} active)` : ''}</span>
                <span className="pref-badge-hint">Tap category to expand</span>
              </div>
              <p className="pref-card-desc">
                Select your dietary preferences, allergies, or health targets. The app cross-checks ingredients and nutritional values instantly.
              </p>

              <div className="preferences-accordion">
                {PREFERENCE_GROUPS.map(group => {
                  const isOpen = openGroup === group.id;
                  const activeInGroup = group.options.filter(o => preferences[o.id]).length;

                  return (
                    <div key={group.id} className={`preference-group-card ${isOpen ? 'open' : ''}`}>
                      <div
                        className="preference-group-header"
                        onClick={() => setOpenGroup(isOpen ? null : group.id)}
                      >
                        <div className="pref-title-wrap">
                          <span className="pref-group-title">{group.title}</span>
                          {activeInGroup > 0 && (
                            <span className="pref-count-badge">{activeInGroup} active</span>
                          )}
                        </div>
                        <ChevronDown size={16} className={`pref-chevron ${isOpen ? 'rotated' : ''}`} style={{ transition: 'transform 0.2s ease', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
                      </div>

                      <div className={`preference-options-grid ${isOpen ? 'open' : ''}`}>
                        {group.options.map(opt => {
                          const isChecked = !!preferences[opt.id];
                          return (
                            <label
                              key={opt.id}
                              className={`pref-option-item ${isChecked ? 'selected' : ''}`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => togglePreference(opt.id)}
                              />
                              <div>
                                <div className="pref-option-label">{opt.label}</div>
                                <div className="pref-option-desc">{opt.desc}</div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>

              {error && (
                <div className="alert-box alert-error" style={{ marginTop: '1rem' }}>
                  <AlertCircle size={16} /> {error}
                </div>
              )}

              <button
                className="btn btn-primary btn-cta"
                style={{ marginTop: '1.25rem' }}
                onClick={handleScan}
                disabled={loading || files.length === 0}
              >
                {loading ? (
                  <>
                    <Loader2 className="spinner" size={16} /> Reading {files.length} photo(s) &amp; checking suitability…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} /> Check Label &amp; Verify Suitability ({files.length} photo{files.length !== 1 ? 's' : ''})
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && result && (
        /* Results View — ordered per Phase 1: compliance one-liner → dates/MRP → preferences → other info */
        <div>
          {/* 1. Compliance One-Liner */}
          {result.complianceOneLiner && (
            <div className={`verdict-banner ${(result.overallStatus === 'PASS' || result.overallStatus === 'COMPLIANT') ? 'pass' : ((result.overallStatus === 'POTENTIAL_NON_COMPLIANCE' || result.overallStatus === 'NON_COMPLIANT' || result.overallStatus === 'FAIL') ? 'fail' : 'warn')}`}>
              <div>
                <div className="verdict-title">
                  {(result.overallStatus === 'PASS' || result.overallStatus === 'COMPLIANT') ? '✓ LABEL COMPLIANT' : ((result.overallStatus === 'POTENTIAL_NON_COMPLIANCE' || result.overallStatus === 'NON_COMPLIANT' || result.overallStatus === 'FAIL') ? '⚠️ POTENTIAL LABEL ISSUE' : (result.overallStatus === 'INSUFFICIENT_EVIDENCE' ? 'ℹ️ INSUFFICIENT EVIDENCE' : 'ℹ️ NEEDS REVIEW'))}
                </div>
                <div className="verdict-sub">{result.complianceOneLiner}</div>
              </div>
              <button className="btn btn-secondary" onClick={handleClear}>
                <RefreshCw size={14} /> Scan Another Product
              </button>
            </div>
          )}

          {/* 2. Key Dates & MRP Quick View — inline strip, not a tile grid */}
          <div className="label-info-strip">
            <div className="label-info-item">
              <span className="label-info-key">Product</span>
              <span className={`label-info-val${!fields.productName ? ' empty' : ''}`}>{sanitizeText(fields.productName, 'Not detected')}</span>
            </div>
            <div className="label-info-item">
              <span className="label-info-key">Net Qty</span>
              <span className={`label-info-val${!fields.netQuantity?.value ? ' empty' : ''}`}>{fields.netQuantity?.value ? `${sanitizeText(fields.netQuantity.value)} ${sanitizeText(fields.netQuantity.unit || '')}` : '—'}</span>
            </div>
            <div className="label-info-item">
              <span className="label-info-key">MRP</span>
              <span className={`label-info-val${!fields.mrp?.value ? ' empty' : ''}`}>{fields.mrp?.value ? `₹ ${sanitizeText(fields.mrp.value)}` : '—'}</span>
            </div>
            <div className="label-info-item">
              <span className="label-info-key">Mfg Date</span>
              <span className={`label-info-val${!fields.dates?.manufacture ? ' empty' : ''}`}>{sanitizeText(fields.dates?.manufacture, '—')}</span>
            </div>
            <div className="label-info-item">
              <span className="label-info-key">Expiry</span>
              <span className={`label-info-val${!(fields.dates?.expiry || fields.dates?.bestBefore) ? ' empty' : ''}`}>{sanitizeText(fields.dates?.expiry || fields.dates?.bestBefore, '—')}</span>
            </div>
          </div>

          {/* 3. Preference Suitability Banner (Only rendered when user selected preferences) */}
          {prefResult.details && Object.keys(prefResult.details).length > 0 ? (
            <div className={`verdict-banner ${prefResult.isSuitable ? 'pass' : 'fail'}`} style={{ marginBottom: '1rem' }}>
              <div>
                <div className="verdict-title">
                  {prefResult.isSuitable ? '✓ SUITABLE FOR YOUR PREFERENCES' : '⚠️ PREFERENCE WARNINGS DETECTED'}
                </div>
                <div className="verdict-sub">
                  Evaluated across {result.photoCount || 1} photo angle(s).
                  {prefResult.warnings?.length > 0 && ` ${prefResult.warnings.length} warning(s) flagged.`}
                </div>
              </div>
            </div>
          ) : (
            <div className="alert-box" style={{ marginBottom: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <Info size={15} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-2)' }}>
                No personal dietary, allergy, or health preferences were selected for this scan. Standard label declarations are displayed below.
              </span>
            </div>
          )}

          {/* Preference Evaluation Results — suitability rows */}
          {prefResult.details && Object.keys(prefResult.details).length > 0 && (
            <div className="card">
              <h2 className="card-title">Personal Suitability Breakdown</h2>
              <div className="suitability-list">
                {Object.entries(prefResult.details).map(([key, item]) => {
                  const isPass = item.status === 'PASS';
                  const isInsufficient = item.status === 'INSUFFICIENT_DATA';
                  const rowClass = isPass ? 'pass-row' : (isInsufficient ? 'warn-row' : 'fail-row');
                  return (
                    <div key={key} className={`suitability-row ${rowClass}`}>
                      <div>
                        <div className="suitability-label">{item.label}</div>
                        <div className="suitability-msg">{item.message}</div>
                      </div>
                      <span className={`status-chip ${isPass ? 'pass' : (isInsufficient ? 'warn' : 'fail')}`}>
                        {item.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* 5. Other Product Info */}
          <div className="card">
            <h2 className="card-title">Other Product Details</h2>
            <div className="fields-grid">
              <FieldCard label="Product Name" value={fields.productName} aiAssisted={isAiAssisted('productName')} />
              {fields.brandName && <FieldCard label="Brand Name" value={fields.brandName} aiAssisted={isAiAssisted('brandName')} />}
              {fields.genericCommodityName && <FieldCard label="Generic Commodity Name" value={fields.genericCommodityName} aiAssisted={isAiAssisted('genericCommodityName')} />}
              <FieldCard label="MRP" value={fields.mrp?.value ? `₹ ${fields.mrp.value} ${fields.mrp.inclusiveOfTaxes ? '(Incl. taxes)' : ''}` : null} aiAssisted={isAiAssisted('mrp')} />
              <FieldCard label="Unit Sale Price (USP)" value={fields.unitSalePrice ? `₹ ${fields.unitSalePrice}` : null} aiAssisted={isAiAssisted('unitSalePrice')} />
              <FieldCard label="Net Quantity" value={fields.netQuantity?.value ? `${fields.netQuantity.value} ${fields.netQuantity.unit || ''}` : null} aiAssisted={isAiAssisted('netQuantity')} />
              <FieldCard label="Manufacturer Name" value={fields.manufacturer?.name} aiAssisted={isAiAssisted('manufacturer.name')} />
              {fields.manufacturer?.address && <FieldCard label="Manufacturer Address" value={fields.manufacturer.address} aiAssisted={isAiAssisted('manufacturer.address')} />}
              <FieldCard label="Country of Origin" value={fields.countryOfOrigin} aiAssisted={isAiAssisted('countryOfOrigin')} />
              <FieldCard label="Ingredients List" value={fields.ingredients} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '1.5rem' }}>
            <button className="btn btn-secondary" onClick={handleClear}>
              <ArrowLeft size={14} /> Back to Scanner
            </button>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleClear}>
              <RefreshCw size={14} /> Scan Another Product
            </button>
          </div>
        </div>
      )}


    </div>
  );
}

/* ============================================================
   OFFICER PORTAL (Default View on Load)
   ============================================================ */
function OfficerPortal({ user, onLogin, onLogout, onSwitchToConsumer }) {
  const [activeTab, setActiveTab] = useState('scan'); // 'scan' | 'repository' | 'dashboard'

  if (!user) {
    return <OfficerAuth onLogin={onLogin} />;
  }

  const isGuest = user.role === 'guest';

  return (
    <div>
      {/* Officer Sub-Navigation */}
      <div className="officer-subnav" style={{ borderRadius: '10px', marginBottom: '1.5rem' }}>
        <div className="subnav-tabs">
          <button
            className={`subnav-tab ${activeTab === 'scan' ? 'active' : ''}`}
            onClick={() => setActiveTab('scan')}
          >
            <FileText size={15} /> Scan & Inspect
          </button>

          <button
            className={`subnav-tab ${activeTab === 'repository' ? 'active' : ''}`}
            onClick={() => setActiveTab('repository')}
          >
            <FolderArchive size={15} /> Inspection Repository
            {isGuest && <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>(Sign in required)</span>}
          </button>

          <button
            className={`subnav-tab ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <BarChart3 size={15} /> Enforcement Dashboard
            {isGuest && <span style={{ fontSize: '0.65rem', opacity: 0.6 }}>(Sign in required)</span>}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div className="user-nav-badge">
            <User size={13} />
            <span>{user.name}</span>
            <span className={`role-pill ${user.role}`}>{user.role}</span>
          </div>

          {isGuest ? (
            <button className="btn btn-primary" style={{ padding: '0.35rem 0.75rem', fontSize: '0.8rem', width: 'auto' }} onClick={onLogout}>
              Sign In
            </button>
          ) : (
            <button className="btn-signout" onClick={onLogout} title="Sign Out">
              <LogOut size={14} /> Sign Out
            </button>
          )}
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'scan' && <OfficerScanView user={user} onNavigateToRepo={() => setActiveTab('repository')} />}
      {activeTab === 'repository' && (
        isGuest ? (
          <GuestRestrictionPrompt onSignIn={onLogout} featureName="Inspection Repository" />
        ) : (
          <OfficerRepositoryView user={user} />
        )
      )}
      {activeTab === 'dashboard' && (
        isGuest ? (
          <GuestRestrictionPrompt onSignIn={onLogout} featureName="Enforcement Dashboard" />
        ) : (
          <OfficerDashboardView user={user} />
        )
      )}
    </div>
  );
}

/* ============================================================
   OFFICER SCAN VIEW (Multi-Photo, Back & Reset)
   ============================================================ */
function OfficerScanView({ user, onNavigateToRepo }) {
  const isGuest = user.role === 'guest';
  const [productFiles, setProductFiles] = useState([]);

  const [saveToRepo, setSaveToRepo] = useState(!isGuest);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  // E-commerce mismatch state
  const [showMismatchTool, setShowMismatchTool] = useState(false);
  const [listingText, setListingText] = useState('');
  const [mismatchResult, setMismatchResult] = useState(null);
  const [mismatchLoading, setMismatchLoading] = useState(false);

  // Phase 1 Session Log: sessionStorage-based scan history
  const SESSION_LOG_KEY = 'drishti_session_log';
  const [sessionLog, setSessionLog] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_LOG_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [sessionLogSearch, setSessionLogSearch] = useState('');
  const [showSessionLog, setShowSessionLog] = useState(false);

  const addToSessionLog = (scanResult) => {
    const entry = {
      productName: scanResult.extractedFields?.productName || 'Unlabeled Product',
      timestamp: new Date().toISOString(),
      overallStatus: scanResult.overallStatus || 'NEEDS_REVIEW',
      findingsCount: (scanResult.findings || []).length,
      photoCount: scanResult.photoCount || 1
    };
    setSessionLog(prev => {
      const updated = [entry, ...prev];
      try { sessionStorage.setItem(SESSION_LOG_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  };

  // Feature 4: "Scan Another Product" & Reset
  const handleResetForNewScan = () => {
    setProductFiles([]);
    setResult(null);
    setError(null);
    setMismatchResult(null);
    setShowMismatchTool(false);
  };

  const handleSelectProductFiles = (newFiles) => {
    const valid = Array.from(newFiles).filter(f => f.type.startsWith('image/'));
    if (result) {
      handleResetForNewScan();
      setProductFiles(valid);
    } else {
      setProductFiles(prev => [...prev, ...valid]);
      setError(null);
    }
  };

  const handleRemoveProductFile = (index) => {
    setProductFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleScan = async () => {
    if (productFiles.length === 0) return;
    setLoading(true);
    setError(null);

    const form = new FormData();
    productFiles.forEach(f => {
      form.append('images', f);
    });
    form.append('saveToRepository', isGuest ? 'false' : saveToRepo.toString());

    try {
      const res = await axios.post('/api/officer/scan', form);
      setResult(res.data);
      addToSessionLog(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Compliance inspection failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!result) return;
    try {
      const reportPayload = {
        scanTimestamp: new Date().toISOString(),
        productName: result.extractedFields?.productName || 'Inspected Product',
        overallStatus: result.overallStatus,
        extractedFields: result.extractedFields,
        findings: result.findings,
        listingMismatchCheck: mismatchResult || { performed: false, mismatches: [] },
        evidenceImages: result.savedInspection?.evidenceImages || []
      };
      const res = await axios.post('/api/officer/report/pdf', reportPayload, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Compliance_Report_${Date.now()}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let errMsg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          errMsg = json.error || text;
        } catch (_) {}
      }
      alert('PDF generation failed: ' + errMsg);
    }
  };

  const handleExportDOCX = async () => {
    if (!result) return;
    try {
      const reportPayload = {
        scanTimestamp: new Date().toISOString(),
        productName: result.extractedFields?.productName || 'Inspected Product',
        overallStatus: result.overallStatus,
        extractedFields: result.extractedFields,
        findings: result.findings,
        listingMismatchCheck: mismatchResult || { performed: false, mismatches: [] }
      };
      const res = await axios.post('/api/officer/report/docx', reportPayload, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Compliance_Report_${Date.now()}.docx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let errMsg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          errMsg = json.error || text;
        } catch (_) {}
      }
      alert('DOCX generation failed: ' + errMsg);
    }
  };

  const handleRunMismatch = async () => {
    if (!result?.extractedFields || !listingText) return;
    setMismatchLoading(true);
    try {
      let parsed = {};
      try { parsed = JSON.parse(listingText); } catch (e) {
        parsed = { title: listingText, mrp: '', netQuantity: '' };
      }
      const res = await axios.post('/api/officer/mismatch-check', {
        extractedFields: result.extractedFields,
        listingDetails: parsed
      });
      setMismatchResult(res.data);
    } catch (err) {
      alert('Mismatch check failed: ' + err.message);
    } finally {
      setMismatchLoading(false);
    }
  };

  const fields = result?.extractedFields || {};
  const findings = result?.findings || [];
  const status = result?.overallStatus || 'UNKNOWN';

  const isAiAssisted = (fieldKey) => {
    if (!fieldKey || !result) return false;
    const ef = result.extractedFields || {};
    if (ef.geminiMetadata?.fallback?.fieldsRecovered?.includes(fieldKey)) return true;
    const declKey = fieldKey.split('.')[0];
    const decl = ef.declarations?.[declKey];
    if (!decl) return false;
    if (decl.aiAssisted === true || decl.source === 'gemini_fallback') return true;
    if (decl.status === 'unverified' || decl.needsReview === true) return true;
    if (typeof decl.confidence === 'number' && decl.confidence < 0.65) return true;
    if (fieldKey.includes('.') && (decl[fieldKey.split('.')[1]]?.aiAssisted || decl[fieldKey.split('.')[1]]?.needsReview)) return true;
    return false;
  };

  return (
    <div>
      {/* Header & Back Action */}
      <div className="section-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h1 className="section-title"><FileText size={24} color="#3b82f6" /> Regulatory Compliance Inspector</h1>
          <p className="section-desc">Multi-angle package label acquisition, conflict detection, and legal report generation.</p>
        </div>

        {result && (
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={handleResetForNewScan}>
              <ArrowLeft size={14} /> Back to Scanner
            </button>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleResetForNewScan}>
              <RefreshCw size={14} /> Scan Another Product
            </button>
          </div>
        )}
      </div>

      {/* Three explicit branches — avoids the else-fires-during-loading crash */}
      {loading && (
        <div className="inspection-progress-card">
          <div className="progress-header">
            <div className="progress-title-text">Regulatory Compliance Inspection Active</div>
            <div className="file-count-pill">
              <Loader2 className="spinner" size={13} /> Analysing {productFiles.length} photo angle{productFiles.length !== 1 ? 's' : ''}
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: 'var(--ink-2)', margin: '0 0 1rem 0' }}>
            Evaluating packaging declarations against Legal Metrology (Packaged Commodities) Rules, 2011. This typically completes in 10–25 seconds.
          </p>

          <div className="progress-pipeline">
            <div className="progress-stage active">
              <CheckCircle2 size={16} color="var(--accent)" />
              <span>Step 1: Reading packaging panels &amp; extracting raw declarations</span>
            </div>
            <div className="progress-stage active">
              <Loader2 className="spinner" size={16} color="var(--accent)" />
              <span>Step 2: Cross-referencing mandatory declarations &amp; verifying unit sale prices</span>
            </div>
            <div className="progress-stage">
              <Shield size={16} color="var(--ink-3)" />
              <span>Step 3: Compiling rule findings, legal citations &amp; audit evidence</span>
            </div>
          </div>
        </div>
      )}

      {!loading && !result && (
        <div className="officer-intake-layout">
          {/* Left Column: Evidence Acquisition */}
          <div className="intake-col evidence-col">
            <div className="card">
              <div className="card-title">
                <span>1. Multi-Angle Packaging Evidence</span>
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                  Rule 6 &amp; Rule 9 Compliance
                </span>
              </div>

              {/* Capture Guidance Banner */}
              <div className="capture-guidance-banner">
                <Sparkles size={15} style={{ flexShrink: 0, marginTop: '1px' }} />
                <div>
                  <strong>Official Inspection Tip:</strong> Avoid direct flash glare on glossy bottles • Hold camera steady • Fill frame with the panel being photographed.
                </div>
              </div>

              <MultiImageUploader
                files={productFiles}
                onSelect={handleSelectProductFiles}
                onRemove={handleRemoveProductFile}
                onClearAll={handleResetForNewScan}
              />
            </div>
          </div>

          {/* Right Column: Repository Settings */}
          <div className="intake-col options-col">
            {/* Central Repository Setting */}
            <div className="card" style={{ padding: 'var(--sp-4)' }}>
              <div className="checkbox-label">
                <input
                  type="checkbox"
                  disabled={isGuest}
                  checked={!isGuest && saveToRepo}
                  onChange={e => setSaveToRepo(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>Save to Central Repository</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--ink-3)' }}>
                    {isGuest ? 'Sign in required to persist evidence to cloud repository' : 'Archived for audit logs and enforcement reports'}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="alert-box alert-error">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            {/* Primary Action Button */}
            <button
              className="btn btn-primary btn-cta"
              onClick={handleScan}
              disabled={loading || productFiles.length === 0}
            >
              <Shield size={16} /> Run Compliance Inspection ({productFiles.length} photo{productFiles.length !== 1 ? 's' : ''})
            </button>
          </div>
        </div>
      )}

      {!loading && result && (
        /* Results Section */
        <div>
          {/* Verdict Banner */}
          <div className={`verdict-banner ${(status === 'PASS' || status === 'COMPLIANT') ? 'pass' : ((status === 'POTENTIAL_NON_COMPLIANCE' || status === 'NON_COMPLIANT' || status === 'FAIL') ? 'fail' : 'warn')}`}>
            <div>
              <div className="verdict-title">OVERALL COMPLIANCE: {status}</div>
              <div className="verdict-sub">
                Evaluated {result.photoCount || 1} photo angle(s).
                {status === 'COMPLIANT' || status === 'PASS'
                  ? ' All applicable mandatory declarations verified.'
                  : (status === 'INSUFFICIENT_EVIDENCE'
                    ? ' Mandatory declarations could not be verified from available photos.'
                    : ' Please review flagged items below.')}
                {result.savedInspection ? ` ✓ Persisted to Central Repository (#${result.savedInspection._id.substring(18)})` : ' Live inspection session (unsaved)'}
              </div>
            </div>

            <div className="export-actions">
              <button className="btn btn-secondary" onClick={handleExportPDF} title="Download Compact PDF Report">
                <Download size={14} /> PDF
              </button>
              <button className="btn btn-secondary" onClick={handleExportDOCX} title="Download Editable Word Document">
                <FileText size={14} /> DOCX (Word)
              </button>
            </div>
          </div>

          {/* Multi-Photo Conflicts Notice if any */}
          {fields.conflicts && fields.conflicts.length > 0 && (
            <div className="alert-box alert-error" style={{ marginBottom: '1.25rem', alignItems: 'flex-start' }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div>
                <strong style={{ display: 'block', marginBottom: '4px' }}>Cross-Angle Packaging Discrepancies Detected:</strong>
                {fields.conflicts.map((c, i) => (
                  <div key={i} style={{ fontSize: '0.8rem' }}>• {sanitizeText(c.message)}</div>
                ))}
              </div>
            </div>
          )}

          {/* Multi-Angle Verification Summary */}
          {result.reconciliation && Object.keys(result.reconciliation.fields || {}).length > 0 && (
            <div className="card" style={{ borderLeft: '3px solid var(--accent-blue)' }}>
              <div className="card-title">
                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Sparkles size={16} color="var(--accent-blue)" /> Multi-Angle Declaration Verification ({result.photoCount || 1} photo angles)
                </span>
                {result.reconciliation.geminiUsed && (
                  <span className="status-chip warn">Cross-Angle Verification Active</span>
                )}
              </div>
              <div className="reconciliation-grid">
                {Object.entries(result.reconciliation.fields).map(([fieldName, info]) => {
                  const isConflict = info.status === 'confirmed_conflict' || info.status === 'unresolved_conflict';
                  return (
                    <div key={fieldName} className={`reconciliation-field-card${isConflict ? ' conflict' : ''}`}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                        <strong style={{ fontSize: '0.82rem', textTransform: 'capitalize' }}>{sanitizeText(fieldName)}</strong>
                        <span className={`status-chip ${isConflict ? 'fail' : 'pass'}`}>
                          {info.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                      {info.value && (
                        <div style={{ fontSize: '0.85rem', color: 'var(--accent-blue)', fontWeight: 600 }}>
                          Canonical: {sanitizeText(typeof info.value === 'object' ? JSON.stringify(info.value) : String(info.value))}
                        </div>
                      )}
                      {info.geminiReasoning && (
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          {sanitizeText(info.geminiReasoning)}
                        </div>
                      )}
                      {info.observations && info.observations.length > 1 && (
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                          Candidates: {info.observations.map(o => `${o.imageId}: "${sanitizeText(typeof o.value === 'object' ? JSON.stringify(o.value) : o.value)}"`).join(' | ')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Extracted Package Declarations — Structured Grouped Sections */}
          <div className="card">
            <h2 className="card-title">1. Extracted Package Declarations</h2>
            <div className="declarations-wrapper">

              {/* Group A: Product Identity */}
              <div className="decl-section">
                <div className="decl-section-header">
                  <div className="decl-section-icon"><FileText size={11} /></div>
                  Product Identity
                </div>
                <div className="decl-fields-grid">
                  <DeclField label="Product Name" value={fields.productName} aiAssisted={isAiAssisted('productName')} />
                  <DeclField label="Brand Name" value={fields.brandName} aiAssisted={isAiAssisted('brandName')} />
                  <DeclField label="Generic Commodity" value={fields.genericCommodityName} aiAssisted={isAiAssisted('genericCommodityName')} />
                  <DeclField label="FSSAI License No." value={fields.fssaiLicenseNumber} aiAssisted={isAiAssisted('fssaiLicenseNumber')} mono />
                  <DeclField label="Batch / Lot No." value={fields.batchNumber} aiAssisted={isAiAssisted('batchNumber')} mono />
                  <DeclField label="Country of Origin" value={fields.countryOfOrigin} aiAssisted={isAiAssisted('countryOfOrigin')} />
                </div>
              </div>

              {/* Group B: Pricing & Quantities */}
              <div className="decl-section">
                <div className="decl-section-header">
                  <div className="decl-section-icon"><BarChart3 size={11} /></div>
                  Pricing &amp; Quantities
                </div>
                <div className="decl-fields-grid">
                  <DeclField label="MRP (₹)" value={fields.mrp?.value ? `₹ ${fields.mrp.value}${fields.mrp.inclusiveOfTaxes ? ' (Incl. taxes)' : ''}` : null} aiAssisted={isAiAssisted('mrp')} />
                  <DeclField label="Unit Sale Price (USP)" value={fields.unitSalePrice ? `₹ ${fields.unitSalePrice}` : null} aiAssisted={isAiAssisted('unitSalePrice')} />
                  <DeclField label="Net Quantity" value={fields.netQuantity?.value ? `${fields.netQuantity.value} ${fields.netQuantity.unit || ''}` : null} aiAssisted={isAiAssisted('netQuantity')} />
                  <DeclField label="Servings per Container" value={fields.servingsPerContainer ? `${fields.servingsPerContainer} servings` : null} />
                  <DeclField label="Serving Size" value={fields.servingSize} />
                </div>
              </div>

              {/* Group C: Critical Dates */}
              <div className="decl-section">
                <div className="decl-section-header">
                  <div className="decl-section-icon"><Calendar size={11} /></div>
                  Critical Dates
                </div>
                <div className="decl-fields-grid">
                  <DeclField label="Manufacturing Date" value={fields.dates?.manufacture} aiAssisted={isAiAssisted('dates.manufacture')} />
                  <DeclField label="Expiry / Best Before" value={fields.dates?.expiry || fields.dates?.bestBefore} aiAssisted={isAiAssisted('dates.expiry')} />
                </div>
              </div>

              {/* Group D: Manufacturer & Responsible Party */}
              <div className="decl-section">
                <div className="decl-section-header">
                  <div className="decl-section-icon"><Shield size={11} /></div>
                  Manufacturer &amp; Responsible Party
                </div>
                <div className="decl-fields-grid">
                  <DeclField label="Manufacturer Name" value={fields.manufacturer?.name} aiAssisted={isAiAssisted('manufacturer.name')} />
                  <DeclField label="Packer / Marketer" value={fields.packer?.name || fields.importer?.name || fields.marketer?.name} aiAssisted={isAiAssisted('marketer.name')} />
                  {fields.manufacturer?.address && (
                    <DeclField label="Manufacturer Address" value={fields.manufacturer.address} aiAssisted={isAiAssisted('manufacturer.address')} wide />
                  )}
                </div>
              </div>

              {/* Group E: Consumer Care */}
              <div className="decl-section">
                <div className="decl-section-header">
                  <div className="decl-section-icon"><Info size={11} /></div>
                  Consumer Care
                </div>
                <div className="decl-fields-grid">
                  <DeclField label="Helpline / Phone" value={fields.consumerCare?.phone} aiAssisted={isAiAssisted('consumerCare.phone')} />
                  <DeclField label="Email" value={fields.consumerCare?.email} />
                  <DeclField label="Consumer Care Name" value={fields.consumerCare?.name} />
                  {fields.consumerCare?.address && (
                    <DeclField label="Consumer Care Address" value={fields.consumerCare.address} wide />
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Rule Evaluations Findings */}
          <div className="card">
            <h2 className="card-title">2. Legal Metrology Rule Findings</h2>
            <div className="findings-table-wrapper">
              <table className="findings-table">
                <thead>
                  <tr>
                    <th>Rule Code</th>
                    <th>Target Field</th>
                    <th>Status</th>
                    <th>Reason / Extracted Value</th>
                    <th>Legal Citation</th>
                  </tr>
                </thead>
                <tbody>
                  {findings.map((f, i) => {
                    const isPass = f.status === 'PASS' || f.status === 'COMPLIANT';
                    const isFail = f.status === 'FAIL' || f.status === 'POTENTIAL_NON_COMPLIANCE';
                    const chipClass = isPass ? 'pass' : (isFail ? 'fail' : 'warn');

                    return (
                      <tr key={i}>
                        <td><span className="rule-code">{f.ruleCode || 'PCR-GEN'}</span></td>
                        <td>{sanitizeText(f.field || 'General')}</td>
                        <td>
                          <span className={`status-chip ${chipClass}`}>
                            {f.status}
                          </span>
                        </td>
                        <td>{sanitizeText(f.reason || f.extractedValue, 'Compliant with standards')}</td>
                        <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{sanitizeText(f.sourceReference || 'PCR 2011, Rule 6')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* E-Commerce Mismatch Tool */}
          <div className="card">
            <div className="card-title">
              <span>3. E-Commerce Listing Cross-Verification</span>
              <button className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => setShowMismatchTool(!showMismatchTool)}>
                {showMismatchTool ? 'Hide Tool' : 'Cross-Check Listing'}
              </button>
            </div>

            {showMismatchTool && (
              <div style={{ marginTop: '0.75rem' }}>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  Paste the JSON or text attributes from the e-commerce listing (e.g. Amazon, Blinkit, Flipkart) to cross-check MRP and net quantity against physical package declarations.
                </p>
                <textarea
                  className="form-input"
                  style={{ height: '80px', fontFamily: 'monospace', fontSize: '0.8rem', marginBottom: '0.75rem' }}
                  placeholder='{"title": "Product Name", "mrp": "150", "netQuantity": "500g"}'
                  value={listingText}
                  onChange={e => setListingText(e.target.value)}
                />
                <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleRunMismatch} disabled={mismatchLoading}>
                  {mismatchLoading ? <Loader2 className="spinner" size={14} /> : 'Verify Mismatch'}
                </button>

                {mismatchResult && (
                  <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--bg-card)', borderRadius: '8px' }}>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
                      Mismatch Check Result:
                    </div>
                    {mismatchResult.mismatches?.length === 0 ? (
                      <span style={{ color: 'var(--status-pass-text)' }}>✓ All attributes match the physical package.</span>
                    ) : (
                      mismatchResult.mismatches?.map((m, idx) => (
                        <div key={idx} style={{ color: 'var(--status-fail-text)', fontSize: '0.85rem', marginBottom: '4px' }}>
                          ⚠️ {m.field}: Listed "{m.listedValue}" vs Physical "{m.extractedValue}" ({m.description})
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation Action Buttons */}
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button className="btn btn-secondary" onClick={handleResetForNewScan}>
              <ArrowLeft size={14} /> Back to Scanner
            </button>
            <button className="btn btn-primary" style={{ width: 'auto' }} onClick={handleResetForNewScan}>
              <RefreshCw size={14} /> Scan Another Product
            </button>
          </div>
        </div>
      )}

      {/* Phase 1 Session Log — sessionStorage-based, resets on browser session end */}
      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div
          className="card-title"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => setShowSessionLog(!showSessionLog)}
        >
          <span>Session Scan Log ({sessionLog.length} scan{sessionLog.length !== 1 ? 's' : ''} this session)</span>
          {showSessionLog ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </div>

        {showSessionLog && (
          <div>
            {/* Search/filter bar */}
            <input
              type="text"
              className="form-input"
              placeholder="Search by product name or status..."
              value={sessionLogSearch}
              onChange={e => setSessionLogSearch(e.target.value)}
              style={{ marginBottom: '0.75rem', fontSize: '0.85rem' }}
            />

            {sessionLog.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '1rem' }}>
                No scans performed in this session yet.
              </p>
            ) : (
              <div className="findings-table-wrapper">
                <table className="findings-table">
                  <thead>
                    <tr>
                      <th>Product Name</th>
                      <th>Status</th>
                      <th>Findings</th>
                      <th>Photos</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sessionLog
                      .filter(entry => {
                        if (!sessionLogSearch.trim()) return true;
                        const q = sessionLogSearch.toLowerCase();
                        return (
                          entry.productName.toLowerCase().includes(q) ||
                          entry.overallStatus.toLowerCase().includes(q)
                        );
                      })
                      .map((entry, idx) => (
                        <tr key={idx}>
                          <td><strong>{entry.productName}</strong></td>
                          <td>
                            <span className={`status-chip ${getStatusBadgeClass(entry.overallStatus)}`}>
                              {entry.overallStatus}
                            </span>
                          </td>
                          <td>{entry.findingsCount} rules</td>
                          <td>{entry.photoCount} angle(s)</td>
                          <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {new Date(entry.timestamp).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        </div>


    </div>
  );
}

/* ============================================================
   OFFICER REPOSITORY VIEW (Downloadable Raw Photos & Details)
   ============================================================ */
function OfficerRepositoryView({ user }) {
  const [inspections, setInspections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [filters, setFilters] = useState({
    productName: '',
    status: 'ALL',
    startDate: '',
    endDate: ''
  });
  const [selectedInspection, setSelectedInspection] = useState(null);

  const fetchRepo = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.productName) params.productName = filters.productName;
      if (filters.status && filters.status !== 'ALL') params.status = filters.status;
      if (filters.startDate) params.startDate = filters.startDate;
      if (filters.endDate) params.endDate = filters.endDate;

      const res = await axios.get('/api/officer/repository', { params });
      setInspections(res.data.inspections || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      console.error('Error fetching repo:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRepo();
  }, [filters.status]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Are you sure you want to delete this inspection and its evidence photos?')) return;
    try {
      await axios.delete(`/api/officer/repository/${id}`);
      fetchRepo();
      if (selectedInspection?._id === id) setSelectedInspection(null);
    } catch (err) {
      alert('Delete failed: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleExportPDF = async (insp, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await axios.post('/api/officer/report/pdf', insp, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Inspection_${insp._id.substring(18)}.pdf`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let errMsg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          errMsg = json.error || text;
        } catch (_) {}
      }
      alert('PDF export failed: ' + errMsg);
    }
  };

  const handleExportDOCX = async (insp, e) => {
    if (e) e.stopPropagation();
    try {
      const res = await axios.post('/api/officer/report/docx', insp, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Inspection_${insp._id.substring(18)}.docx`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => window.URL.revokeObjectURL(url), 1000);
    } catch (err) {
      let errMsg = err.message;
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const json = JSON.parse(text);
          errMsg = json.error || text;
        } catch (_) {}
      }
      alert('DOCX export failed: ' + errMsg);
    }
  };

  // Feature 5: Download Raw Photos
  const handleDownloadSinglePhoto = (imgUrl, filename) => {
    const link = document.createElement('a');
    link.href = imgUrl;
    link.target = '_blank';
    link.download = filename || 'evidence_photo.jpg';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title"><FolderArchive size={24} color="#3b82f6" /> Product / Inspection Repository</h1>
        <p className="section-desc">Search, review, re-export reports, and download original high-res evidence photos.</p>
      </div>

      {/* Filter Bar */}
      <div className="filter-bar">
        <input
          type="text"
          className="filter-input"
          placeholder="Search by product name..."
          value={filters.productName}
          onChange={e => setFilters({ ...filters, productName: e.target.value })}
        />

        <select
          className="filter-select"
          value={filters.status}
          onChange={e => setFilters({ ...filters, status: e.target.value })}
        >
          <option value="ALL">All Compliance Statuses</option>
          <option value="PASS">PASS (Compliant)</option>
          <option value="POTENTIAL_NON_COMPLIANCE">POTENTIAL_NON_COMPLIANCE (Violation)</option>
          <option value="NEEDS_REVIEW">NEEDS_REVIEW</option>
        </select>

        <input
          type="date"
          className="filter-input"
          style={{ maxWidth: '160px' }}
          value={filters.startDate}
          onChange={e => setFilters({ ...filters, startDate: e.target.value })}
        />

        <button className="btn btn-secondary" onClick={fetchRepo} disabled={loading}>
          <Search size={14} /> Search
        </button>
      </div>

      {/* Table */}
      <div className="repo-table-wrapper">
        <table className="repo-table">
          <thead>
            <tr>
              <th>Product Name</th>
              <th>Status</th>
              <th>Saved By</th>
              <th>Date / Time</th>
              <th>Media</th>
              <th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem' }}><Loader2 className="spinner" size={24} /></td></tr>
            ) : inspections.length === 0 ? (
              <tr><td colSpan="6" style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>No inspection records found.</td></tr>
            ) : (
              inspections.map(insp => (
                <tr key={insp._id} onClick={() => setSelectedInspection(insp)} style={{ cursor: 'pointer' }}>
                  <td><strong>{insp.productName || 'Unlabeled Product'}</strong></td>
                  <td>
                    <span className={`status-chip ${getStatusBadgeClass(insp.overallStatus)}`}>
                      {insp.overallStatus}
                    </span>
                  </td>
                  <td>{insp.savedBy?.name}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(insp.createdAt).toLocaleDateString()}</td>
                  <td>
                    <span style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)' }}>
                      📷 {insp.evidenceImages?.length || 0} Photos
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.4rem' }}>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => handleExportPDF(insp, e)} title="Download PDF">
                        <Download size={12} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={(e) => handleExportDOCX(insp, e)} title="Download Word DOCX">
                        <FileText size={12} />
                      </button>
                      <button className="btn btn-secondary" style={{ padding: '4px 8px', fontSize: '0.75rem', color: 'var(--status-fail-text)' }} onClick={(e) => handleDelete(insp._id, e)} title="Delete">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal with Downloadable Photos */}
      {selectedInspection && (
        <div className="modal-overlay" onClick={() => setSelectedInspection(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedInspection.productName}</h2>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  ID: #{selectedInspection._id} · Inspected by {selectedInspection.savedBy?.name} on {new Date(selectedInspection.createdAt).toLocaleString()}
                </span>
              </div>
              <button className="btn btn-secondary" style={{ padding: '4px 8px' }} onClick={() => setSelectedInspection(null)}>✕</button>
            </div>

            {/* Status & Export Actions */}
            <div className={`verdict-banner ${getStatusBadgeClass(selectedInspection.overallStatus)}`}>
              <div className="verdict-title">{selectedInspection.overallStatus}</div>
              <div className="export-actions">
                <button className="btn btn-secondary" onClick={() => handleExportPDF(selectedInspection)}>PDF</button>
                <button className="btn btn-secondary" onClick={() => handleExportDOCX(selectedInspection)}>DOCX</button>
              </div>
            </div>

            {/* Evidence Gallery with Direct Download Links */}
            {selectedInspection.evidenceImages && selectedInspection.evidenceImages.length > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div className="form-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span>Original Evidence Photos ({selectedInspection.evidenceImages.length})</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Hosted on Cloudinary</span>
                </div>
                <div className="evidence-gallery">
                  {selectedInspection.evidenceImages.map((img, idx) => (
                    <div key={idx} className="evidence-thumb-card">
                      <a href={img.url} target="_blank" rel="noopener noreferrer">
                        <img src={img.url} alt={img.caption || 'Evidence'} />
                      </a>
                      <span className="evidence-caption">{img.caption || `Photo #${idx + 1}`}</span>
                      <button
                        className="btn btn-secondary"
                        style={{ width: '100%', marginTop: '6px', padding: '4px 8px', fontSize: '0.75rem' }}
                        onClick={() => handleDownloadSinglePhoto(img.url, `Inspection_${selectedInspection._id}_photo_${idx+1}.jpg`)}
                      >
                        <Download size={11} /> Download Original
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Declarations Grid */}
            <div className="fields-grid" style={{ marginTop: '1rem' }}>
              <FieldCard label="MRP" value={selectedInspection.extractedFields?.mrp?.value ? `₹ ${selectedInspection.extractedFields.mrp.value}` : null} />
              <FieldCard label="Net Quantity" value={selectedInspection.extractedFields?.netQuantity?.value ? `${selectedInspection.extractedFields.netQuantity.value} ${selectedInspection.extractedFields.netQuantity.unit || ''}` : null} />
              <FieldCard label="Mfg Date" value={selectedInspection.extractedFields?.dates?.manufacture} />
              <FieldCard label="Manufacturer" value={selectedInspection.extractedFields?.manufacturer?.name} />
            </div>

            {/* Rule Findings */}
            <div className="findings-table-wrapper" style={{ marginTop: '1rem' }}>
              <table className="findings-table">
                <thead>
                  <tr>
                    <th>Rule Code</th>
                    <th>Target Field</th>
                    <th>Status</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedInspection.findings || []).map((f, i) => (
                    <tr key={i}>
                      <td><strong>{f.ruleCode}</strong></td>
                      <td>{f.field}</td>
                      <td>
                        <span className={`status-chip ${f.status === 'PASS' ? 'pass' : 'fail'}`}>{f.status}</span>
                      </td>
                      <td>{f.reason || f.extractedValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button className="btn btn-secondary" onClick={() => setSelectedInspection(null)} style={{ marginTop: '1.25rem' }}>
              <ArrowLeft size={14} /> Back to Repository List
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   OFFICER DASHBOARD VIEW
   ============================================================ */
function OfficerDashboardView({ user }) {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDash() {
      try {
        const res = await axios.get('/api/officer/dashboard');
        setDashboardData(res.data);
      } catch (err) {
        console.error('Failed to load dashboard:', err);
      } finally {
        setLoading(false);
      }
    }
    loadDash();
  }, []);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '3rem' }}><Loader2 className="spinner" size={32} /></div>;
  }

  const summary = dashboardData?.summary || { total: 0, compliant: 0, nonCompliant: 0, complianceRate: 0 };
  const violations = dashboardData?.topViolations || [];
  const trendData = dashboardData?.trendData || [];
  const recent = dashboardData?.recentInspections || [];

  return (
    <div>
      <div className="section-header">
        <h1 className="section-title"><BarChart3 size={24} color="#3b82f6" /> Enforcement Analytics Dashboard</h1>
        <p className="section-desc">
          {user.role === 'admin' ? 'Aggregated compliance metrics across all departmental officers.' : `Personal enforcement metrics for ${user.name}.`}
        </p>
      </div>

      {/* KPI Cards */}
      <div className="dashboard-grid">
        <div className="kpi-card total">
          <div className="kpi-icon"><FolderArchive size={20} color="#60a5fa" /></div>
          <div className="kpi-content">
            <div className="kpi-label">Total Saved Inspections</div>
            <div className="kpi-value">{summary.total}</div>
          </div>
        </div>

        <div className="kpi-card pass">
          <div className="kpi-icon"><CheckCircle2 size={20} color="#34d399" /></div>
          <div className="kpi-content">
            <div className="kpi-label">Compliant Packages (PASS)</div>
            <div className="kpi-value">{summary.compliant}</div>
          </div>
        </div>

        <div className="kpi-card fail">
          <div className="kpi-icon"><XCircle size={20} color="#f87171" /></div>
          <div className="kpi-content">
            <div className="kpi-label">Violations Detected</div>
            <div className="kpi-value">{summary.nonCompliant}</div>
          </div>
        </div>

        <div className="kpi-card rate">
          <div className="kpi-icon"><Shield size={20} color="#22d3ee" /></div>
          <div className="kpi-content">
            <div className="kpi-label">Compliance Rate</div>
            <div className="kpi-value">{summary.complianceRate}%</div>
          </div>
        </div>
      </div>

      {/* Charts & Trends Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '1.5rem', marginBottom: '1.5rem' }}>
        {/* Trend Bar Chart */}
        <div className="card">
          <h2 className="card-title">14-Day Activity Trend</h2>
          <div className="trend-chart-container">
            {trendData.map((d, i) => {
              const maxVal = Math.max(...trendData.map(t => t.total), 5);
              const passHeight = (d.compliant / maxVal) * 120;
              const failHeight = (d.nonCompliant / maxVal) * 120;
              return (
                <div key={i} className="trend-bar-group">
                  <div className="trend-bars-stacked" style={{ height: `${Math.max(passHeight + failHeight, 4)}px` }}>
                    <div className="trend-bar-segment fail" style={{ height: `${failHeight}px` }} />
                    <div className="trend-bar-segment pass" style={{ height: `${passHeight}px` }} />
                  </div>
                  <span className="trend-date-label">{d.date.substring(5)}</span>
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: '0.75rem', fontSize: '0.75rem' }}>
            <span style={{ color: 'var(--status-pass-text)' }}>■ Compliant (PASS)</span>
            <span style={{ color: 'var(--status-fail-text)' }}>■ Violation (NON-COMPLIANT)</span>
          </div>
        </div>

        {/* Top Violations */}
        <div className="card">
          <h2 className="card-title">Top Regulatory Violations</h2>
          {violations.length === 0 ? (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No violations recorded yet.
            </div>
          ) : (
            <div className="violations-list">
              {violations.map((v, i) => (
                <div key={i} className="violation-item">
                  <div className="violation-info">
                    <span className="violation-code">{v.ruleCode} · {v.field}</span>
                    <span className="violation-reason">{v.reason || 'Missing or improper declaration'}</span>
                  </div>
                  <span className="violation-count-badge">{v.count} Cases</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Inspections Table */}
      <div className="card">
        <h2 className="card-title">Recent Scans</h2>
        <div className="findings-table-wrapper">
          <table className="findings-table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Status</th>
                <th>Officer</th>
                <th>Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td><strong>{r.productName}</strong></td>
                  <td>
                    <span className={`status-chip ${getStatusBadgeClass(r.overallStatus)}`}>{r.overallStatus}</span>
                  </td>
                  <td>{r.savedBy?.name}</td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{new Date(r.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   MULTI-IMAGE UPLOADER COMPONENT (Mobile Camera + Gallery + Thumbnails)
   ============================================================ */
function MultiImageUploader({ files = [], onSelect, onRemove, onClearAll, disabled = false }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Memoize Blob URLs to prevent memory leak and revoke on files change or unmount
  const previews = React.useMemo(() => {
    return files.map(file => ({
      file,
      url: URL.createObjectURL(file)
    }));
  }, [files]);

  React.useEffect(() => {
    return () => {
      previews.forEach(p => {
        try { URL.revokeObjectURL(p.url); } catch (e) {}
      });
    };
  }, [previews]);

  const handleChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onSelect(e.target.files);
      e.target.value = '';
    }
  };

  const handleDragOver = (e) => { e.preventDefault(); setIsDragOver(true); };
  const handleDragLeave = () => setIsDragOver(false);
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files?.length > 0) onSelect(e.dataTransfer.files);
  };

  const zoneClass = ['upload-zone-pro', isDragOver ? 'dragover' : '', files.length > 0 ? 'has-files' : ''].filter(Boolean).join(' ');

  return (
    <div className="multi-uploader-card">
      <div
        className={zoneClass}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-grid-inner">
          <div className="upload-action-col">
            <div className="upload-instruction-title">Package Label Evidence</div>
            <p className="upload-instruction-desc">
              Upload clear photos covering each panel of the package. Multiple angles allow cross-verification of mandatory declarations.
            </p>

            <div className="upload-btn-row" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={16} /> Choose Package Photos
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => cameraInputRef.current?.click()}
              >
                <Camera size={16} /> Take Photo (Camera)
              </button>
            </div>

            <div className="upload-subhint">
              <span>Or drag and drop image files directly here • JPG, PNG, WEBP</span>
            </div>
          </div>

          <div className="upload-guide-col">
            <div className="guide-panel-title">Required Package Panels</div>
            <div className="guide-panel-items">
              <div className="guide-panel-item"><span className="guide-dot" /> Front Panel (Brand, Name, Net Quantity)</div>
              <div className="guide-panel-item"><span className="guide-dot" /> Information Panel (MRP, Mfg/Exp Date, Batch)</div>
              <div className="guide-panel-item"><span className="guide-dot" /> Ingredients &amp; Nutrition Table</div>
              <div className="guide-panel-item"><span className="guide-dot" /> Manufacturer Details &amp; Consumer Care</div>
            </div>
          </div>
        </div>

        {/* Hidden File Inputs */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </div>

      {/* Thumbnail Strip with Accessible Touch Removal */}
      {files.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                Attached Photos ({files.length})
              </span>
              {onClearAll && (
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClearAll(); }}
                  disabled={disabled}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink-3)',
                    fontSize: '0.75rem',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '0 4px'
                  }}
                  title="Clear all attached photos"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="file-count-pill">
              <CheckCircle2 size={12} /> {files.length} photo{files.length !== 1 ? 's' : ''} ready
            </div>
          </div>
          <div className="thumbnail-strip">
            {previews.map((item, idx) => (
              <div key={idx} className="thumb-item">
                <img src={item.url} alt={`Photo ${idx+1}`} loading="lazy" />
                <button
                  type="button"
                  className="thumb-remove-btn"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(idx); }}
                  disabled={disabled}
                  title="Remove this photo"
                  aria-label={`Remove photo ${idx+1}`}
                >
                  ✕
                </button>
                <span className="thumb-label">#{idx + 1}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   OFFICER AUTHENTICATION (Login / Signup / Forgot OTP)
   ============================================================ */
function OfficerAuth({ onLogin }) {
  const [tab, setTab] = useState('signin'); // 'signin' | 'signup' | 'forgot'
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    otp: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  const clearMsgs = () => { setError(null); setSuccessMsg(null); };

  const handleSignIn = async (e) => {
    e.preventDefault();
    clearMsgs();
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/login', {
        email: formData.email,
        password: formData.password
      });
      onLogin(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Please check credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e) => {
    e.preventDefault();
    clearMsgs();
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/signup', {
        name: formData.name,
        email: formData.email,
        password: formData.password
      });
      onLogin(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    clearMsgs();
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/guest');
      onLogin(res.data.user, res.data.token);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not start guest session.');
    } finally {
      setLoading(false);
    }
  };

  const handleSendOTP = async (e) => {
    e.preventDefault();
    clearMsgs();
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/forgot-password', { email: formData.email });
      setOtpSent(true);
      setSuccessMsg(res.data.message || 'Verification code sent to your email.');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to dispatch verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    clearMsgs();
    if (formData.newPassword !== formData.confirmPassword) {
      return setError('Passwords do not match.');
    }
    setLoading(true);
    try {
      const res = await axios.post('/api/auth/reset-password', {
        email: formData.email,
        otp: formData.otp,
        newPassword: formData.newPassword
      });
      setSuccessMsg(res.data.message);
      setTimeout(() => {
        setTab('signin');
        setOtpSent(false);
      }, 1500);
    } catch (err) {
      setError(err.response?.data?.error || 'Password reset failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-header">
        <div className="logo-icon" style={{ margin: '0 auto 0.75rem auto', width: 42, height: 42 }}>
          <Shield size={22} />
        </div>
        <h2 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Legal Metrology Enforcement</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Officer & Administrator Portal</p>
      </div>

      <div className="auth-tabs">
        <button
          className={`auth-tab ${tab === 'signin' ? 'active' : ''}`}
          onClick={() => { setTab('signin'); clearMsgs(); }}
        >
          Sign In
        </button>
        <button
          className={`auth-tab ${tab === 'signup' ? 'active' : ''}`}
          onClick={() => { setTab('signup'); clearMsgs(); }}
        >
          Sign Up
        </button>
        <button
          className={`auth-tab ${tab === 'forgot' ? 'active' : ''}`}
          onClick={() => { setTab('forgot'); clearMsgs(); }}
        >
          Reset Key
        </button>
      </div>

      {error && <div className="alert-box alert-error"><AlertCircle size={15} /> {error}</div>}
      {successMsg && <div className="alert-box alert-success"><CheckCircle2 size={15} /> {successMsg}</div>}

      {/* Sign In */}
      {tab === 'signin' && (
        <form onSubmit={handleSignIn}>
          <div className="form-group">
            <label className="form-label">Official Email</label>
            <input
              type="email"
              required
              className="form-input"
              placeholder="officer@metrology.gov.in"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              type="password"
              required
              className="form-input"
              placeholder="••••••••"
              value={formData.password}
              onChange={e => setFormData({ ...formData, password: e.target.value })}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
            {loading ? <Loader2 className="spinner" size={16} /> : 'Sign In as Officer'}
          </button>
        </form>
      )}

      {/* Sign Up */}
      {tab === 'signup' && (
        <form onSubmit={handleSignUp}>
          <div className="form-group">
            <label className="form-label">Officer Full Name</label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="Inspector Ananya Roy"
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Email Address</label>
            <input
              type="email"
              required
              className="form-input"
              placeholder="ananya.roy@gov.in"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password (Min 6 characters)</label>
            <input
              type="password"
              required
              minLength={6}
              className="form-input"
              placeholder="••••••••"
              value={formData.password}
              onChange={e => setFormData({ ...formData, password: e.target.value })}
            />
          </div>

          <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
            {loading ? <Loader2 className="spinner" size={16} /> : 'Create Officer Account'}
          </button>
        </form>
      )}

      {/* Reset Password */}
      {tab === 'forgot' && (
        <div>
          {!otpSent ? (
            <form onSubmit={handleSendOTP}>
              <div className="form-group">
                <label className="form-label">Registered Officer Email</label>
                <input
                  type="email"
                  required
                  className="form-input"
                  placeholder="officer@metrology.gov.in"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
                {loading ? <Loader2 className="spinner" size={16} /> : 'Send 6-Digit OTP Code'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label className="form-label">6-Digit Verification Code</label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  className="form-input"
                  placeholder="123456"
                  style={{ letterSpacing: '4px', textAlign: 'center', fontSize: '1.1rem', fontWeight: 'bold' }}
                  value={formData.otp}
                  onChange={e => setFormData({ ...formData, otp: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  className="form-input"
                  placeholder="New password"
                  value={formData.newPassword}
                  onChange={e => setFormData({ ...formData, newPassword: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  className="form-input"
                  placeholder="Confirm new password"
                  value={formData.confirmPassword}
                  onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
              </div>

              <button type="submit" className="btn btn-primary" disabled={loading} style={{ marginTop: '0.5rem' }}>
                {loading ? <Loader2 className="spinner" size={16} /> : 'Reset Password & Proceed'}
              </button>
            </form>
          )}
        </div>
      )}

      {/* Guest Mode */}
      <button className="btn btn-guest" onClick={handleGuest} disabled={loading}>
        ⚡ Continue as Guest (No Login Required)
      </button>
    </div>
  );
}

/* ============================================================
   GUEST RESTRICTION PROMPT
   ============================================================ */
function GuestRestrictionPrompt({ onSignIn, featureName }) {
  return (
    <div className="guest-restriction-wrap">
      <div className="logo-icon" style={{ margin: '0 auto', width: 44, height: 44 }}>
        <Lock size={20} />
      </div>
      <h2>Sign In to Access {featureName}</h2>
      <p>
        Guest mode permits scanning without database persistence. To save scans, search past inspections, and review analytical trends, please sign in with an officer or admin account.
      </p>
      <button className="btn btn-primary" style={{ width: 'auto', margin: '0 auto' }} onClick={onSignIn}>
        <UserCheck size={16} /> Sign In or Register as Officer
      </button>
    </div>
  );
}

/* ============================================================
   SHARED REUSABLE COMPONENTS & UTILITIES
   ============================================================ */

/**
 * Helper to normalize compliance status classes across all portal views.
 * Handles 'PASS' | 'COMPLIANT' as green pass,
 * 'FAIL' | 'POTENTIAL_NON_COMPLIANCE' | 'NON_COMPLIANT' as red fail,
 * and 'INSUFFICIENT_EVIDENCE' | 'REVIEW' | 'NEEDS_REVIEW' as amber warn.
 */
function getStatusBadgeClass(status) {
  if (!status) return 'warn';
  const s = String(status).toUpperCase();
  if (s === 'PASS' || s === 'COMPLIANT') return 'pass';
  if (s === 'POTENTIAL_NON_COMPLIANCE' || s === 'NON_COMPLIANT' || s === 'FAIL') return 'fail';
  return 'warn';
}

/**
 * Universal text sanitizer for user-facing display strings.
 * Removes broken encoding, mojibake (e.g. "â‚¹", "â€“"), OCR noise like "&þ" or "þ",
 * and returns clean text or a provided fallback.
 */
function sanitizeText(val, fallback = '—') {
  if (val === null || val === undefined) return fallback;
  if (typeof val !== 'string') return String(val);

  let s = val.trim();
  if (!s || s === '-' || s === 'null' || s === 'undefined') return fallback;

  // 1. Fix common mojibake sequences
  s = s.replace(/â‚¹/g, '₹')
       .replace(/â€“/g, '—')
       .replace(/â€”/g, '—')
       .replace(/â€™/g, "'")
       .replace(/â€˜/g, "'")
       .replace(/â€œ/g, '"')
       .replace(/â€/g, '"')
       .replace(/Ã©/g, 'é')
       .replace(/Ã¢/g, 'â')
       .replace(/Ã¼/g, 'ü');

  // 2. Fix broken thorn / ampersand artifacts ("&þ" -> "&", isolated "þ" -> "")
  s = s.replace(/&þ/g, '&')
       .replace(/&amp;þ/g, '&')
       .replace(/[þðýÿøæœ§±µ¿¡†‡¶°\u00FE\u00FD\u00F0]/g, ' ');

  // 3. Remove non-printable control characters
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // 4. Collapse extra spaces
  s = s.replace(/\s+/g, ' ').trim();

  // 5. If string is purely junk symbols or empty, return fallback
  if (!s || /^[\s\-_.:,;/'"&|*~`!@#$%^()=+<>{}[\]\\]+$/.test(s)) {
    return fallback;
  }

  return s;
}

/** Flat FieldCard — used in consumer view & detail modal */
function FieldCard({ label, value, aiAssisted = false, reasoning = null }) {
  const cleanVal = sanitizeText(value, null);
  const empty = !cleanVal;
  return (
    <div className="field-card" style={aiAssisted ? { borderColor: 'var(--warn-border)', background: 'var(--warn-bg)' } : {}}>
      <div className="field-label">
        <span>{label}</span>
        {aiAssisted && <span className="ai-badge" title="Couldn't be read clearly from the photo — please double-check this value.">Check Value</span>}
      </div>
      <div className={`field-value ${empty ? 'empty' : ''}`}>{empty ? 'Not detected' : cleanVal}</div>
      {aiAssisted && (
        <div style={{ fontSize: '0.70rem', color: 'var(--warn)', marginTop: '4px', lineHeight: '1.3', fontWeight: 600 }}>
          Couldn't be read clearly from the photo — please double-check this value.
        </div>
      )}
      {reasoning && (
        <div style={{ fontSize: '0.68rem', color: 'var(--ink-3)', marginTop: '2px' }}>{sanitizeText(reasoning)}</div>
      )}
    </div>
  );
}

/** DeclField — used inside the structured declarations grouped sections */
function DeclField({ label, value, aiAssisted = false, mono = false, wide = false }) {
  const cleanVal = sanitizeText(value, null);
  const empty = !cleanVal;
  return (
    <div className={`decl-field-cell${wide ? ' wide' : ''}`} style={aiAssisted ? { borderColor: 'var(--warn-border)', background: 'var(--warn-bg)' } : {}}>
      <div className="decl-field-label">
        <span>{label}</span>
        {aiAssisted && <span className="ai-badge" title="Couldn't be read clearly from the photo — please double-check this value.">Check Value</span>}
      </div>
      <div className={`decl-field-value${empty ? ' empty' : ''}${mono ? ' mono' : ''}`}>
        {empty ? 'Not detected' : cleanVal}
      </div>
      {aiAssisted && (
        <div style={{ fontSize: '0.68rem', color: 'var(--warn)', marginTop: '2px', lineHeight: '1.25', fontWeight: 600 }}>
          Couldn't be read clearly from the photo — please double-check this value.
        </div>
      )}
    </div>
  );
}
