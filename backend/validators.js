
const Validators = {
  topic: (topic) => {
    if (!topic || typeof topic !== 'string') return false;
    const trimmed = topic.trim();
    // 3-80 chars: letters, numbers, spaces, hyphens, underscores, and common punctuation
    const regex = /^[a-zA-Z0-9\s_,.'()-]{3,80}$/;
    return regex.test(trimmed);
  },

  questionText: (text) => {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return trimmed.length >= 10 && trimmed.length <= 5000;
  },

  options: (options) => {
    if (!Array.isArray(options)) return false;
    // 4-6 options standard
    if (options.length < 4 || options.length > 6) return false;
    // Each option: string, 1-500 chars
    return options.every(opt => 
      typeof opt === 'string' && 
      opt.trim().length >= 1 && 
      opt.trim().length <= 500
    );
  },

  correctAnswer: (answer, optionsLength) => {
    if (typeof answer !== 'number') return false;
    // Must be valid index
    return answer >= 0 && answer < optionsLength;
  },

  fileName: (fileName) => {
    if (!fileName || typeof fileName !== 'string') return false;
    // Prevent path traversal
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return false;
    }
    // Only allow: letters, numbers, spaces, dots, hyphens, underscores
    const regex = /^[a-zA-Z0-9\s._-]+\.[a-zA-Z0-9]{1,4}$/;
    return regex.test(fileName);
  },

  email: (email) => {
    if (!email || typeof email !== 'string') return false;
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email.trim());
  }
};

module.exports = Validators;