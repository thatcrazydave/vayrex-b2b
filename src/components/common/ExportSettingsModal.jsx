import React, { useState } from 'react';
import { FiDownload, FiX, FiType, FiMaximize } from 'react-icons/fi';
import '../../styles/exportSettings.css';

const FONT_OPTIONS = [
  { value: 'Helvetica', label: 'Helvetica (Default)', sample: 'The quick brown fox' },
  { value: 'Times', label: 'Times New Roman', sample: 'The quick brown fox' },
  { value: 'Courier', label: 'Courier (Monospace)', sample: 'The quick brown fox' }
];

const SIZE_OPTIONS = [
  { value: 9, label: 'Small (9pt)' },
  { value: 11, label: 'Medium (11pt)' },
  { value: 13, label: 'Large (13pt)' },
  { value: 15, label: 'Extra Large (15pt)' }
];

const ExportSettingsModal = ({ isOpen, onClose, onExport, topic, loading = false }) => {
  const [fontSize, setFontSize] = useState(11);
  const [fontFamily, setFontFamily] = useState('Helvetica');
  const [includeAnswers, setIncludeAnswers] = useState(true);
  const [format, setFormat] = useState('questions');

  if (!isOpen) return null;

  const handleExport = () => {
    onExport({
      fontSize,
      fontFamily,
      includeAnswers,
      format
    });
  };

  const fontFamilyCSS = {
    'Helvetica': 'Helvetica, Arial, sans-serif',
    'Times': '"Times New Roman", Times, serif',
    'Courier': '"Courier New", Courier, monospace'
  };

  return (
    <div className="export-modal-overlay" onClick={onClose}>
      <div className="export-modal" onClick={e => e.stopPropagation()}>
        <div className="export-modal-header">
          <h3><FiDownload size={18} /> Export PDF</h3>
          <button className="export-modal-close" onClick={onClose}>
            <FiX size={18} />
          </button>
        </div>

        <div className="export-modal-body">
          <div className="export-topic-badge">{topic}</div>

          {/* Font Family */}
          <div className="export-setting-group">
            <label className="export-setting-label">
              <FiType size={14} /> Font Style
            </label>
            <div className="export-font-options">
              {FONT_OPTIONS.map(f => (
                <button
                  key={f.value}
                  className={`export-font-btn ${fontFamily === f.value ? 'active' : ''}`}
                  onClick={() => setFontFamily(f.value)}
                >
                  <span className="export-font-name">{f.label}</span>
                  <span
                    className="export-font-sample"
                    style={{ fontFamily: fontFamilyCSS[f.value], fontSize: '13px' }}
                  >
                    {f.sample}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Font Size */}
          <div className="export-setting-group">
            <label className="export-setting-label">
              <FiMaximize size={14} /> Font Size
            </label>
            <div className="export-size-options">
              {SIZE_OPTIONS.map(s => (
                <button
                  key={s.value}
                  className={`export-size-btn ${fontSize === s.value ? 'active' : ''}`}
                  onClick={() => setFontSize(s.value)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Format */}
          <div className="export-setting-group">
            <label className="export-setting-label">Format</label>
            <div className="export-format-options">
              <button
                className={`export-format-btn ${format === 'questions' ? 'active' : ''}`}
                onClick={() => setFormat('questions')}
              >
                Questions + Answers
              </button>
              <button
                className={`export-format-btn ${format === 'exam' ? 'active' : ''}`}
                onClick={() => setFormat('exam')}
              >
                Exam (No Answers)
              </button>
            </div>
          </div>

          {/* Include Answers toggle (only for questions format) */}
          {format === 'questions' && (
            <div className="export-setting-group">
              <label className="export-toggle-label">
                <input
                  type="checkbox"
                  checked={includeAnswers}
                  onChange={e => setIncludeAnswers(e.target.checked)}
                />
                <span className="export-toggle-text">Highlight correct answers</span>
              </label>
            </div>
          )}

          {/* Preview hint */}
          <div className="export-preview-hint" style={{ fontFamily: fontFamilyCSS[fontFamily], fontSize: `${fontSize}px` }}>
            Q1. This is how your questions will look in the exported PDF.
          </div>
        </div>

        <div className="export-modal-footer">
          <button className="export-cancel-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button className="export-confirm-btn" onClick={handleExport} disabled={loading}>
            <FiDownload size={14} />
            {loading ? 'Exporting...' : 'Export PDF'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExportSettingsModal;
