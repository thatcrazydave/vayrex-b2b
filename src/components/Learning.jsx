import React, { useState, useEffect, useRef } from "react";
import { useAuth } from "../contexts/AuthContext.jsx";
import API, { aiChat, exportPDF } from "../services/api.js";
import { FiEye, FiEyeOff, FiX, FiDownload } from "react-icons/fi";
import { toast } from "react-toastify";
import { showToast } from "../utils/toast.js";
import "../styles/learning.css";
import { useNetworkStatus } from "../hooks/useNetworkStatus";

const formatTime = (minutes) => {
  const m = Math.floor(minutes).toString().padStart(2, "0");
  const s = Math.floor((minutes % 1) * 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

const formatQuestionType = (type) => {
  switch ((type || '').toLowerCase()) {
    case 'multiple-choice':
      return 'Multiple Choice';
    case 'fill-in-blank':
      return 'Fill-in Gap';
    case 'true-false':
      return 'True/False';
    case 'short-answer':
    case 'essay':
      return 'Theory';
    default:
      return 'Question';
  }
};

export default function Learning() {
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const [topics, setTopics] = useState([]);
  const [selectedTopic, setSelectedTopic] = useState("");
  const [limit, setLimit] = useState(5);

  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [mode, setMode] = useState("Exam");
  const [revealedAnswers, setRevealedAnswers] = useState({}); 
  const [practiceResults, setPracticeResults] = useState({});
  const [activeIndex, setActiveIndex] = useState(0);

  // Timer state (now in minutes)
  const [initialMinutes, setInitialMinutes] = useState(5);
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef(null);
  const [running, setRunning] = useState(false);
  const [resultSummary, setResultSummary] = useState(null);
  const [submitted, setSubmitted] = useState(false);
  const [showScorePopup, setShowScorePopup] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState(null);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  useEffect(() => {
    // fetch topics once
    const fetchTopics = async () => {
      try {
        const res = await API.get("/topics");
        const topicsList = res.data.map(t => t.topic);
        setTopics(topicsList);
      } catch (err) {
        console.error("Error fetching topics:", err);
        toast.error("Failed to load topics");
      }
    };
    fetchTopics();
    return () => clearInterval(timerRef.current);
  }, [user]);

  useEffect(() => {
    if (questions.length > 0) {
      setActiveIndex(0);
    }
  }, [questions.length]);

  useEffect(() => {
    if (!running) return;
    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.0167) { 
          clearInterval(timerRef.current);
          setRunning(false);
          handleSubmit();
          return 0;
        }
        return prev - 0.0167;
      });
    }, 1000);

    return () => clearInterval(timerRef.current);
  }, [running]);

  const fetchQuestions = async () => {
    if (!selectedTopic) {
      toast.error("Please select a topic");
      return;
    }
    toast.info("Loading questions...");
    setSubmitted(false);
    setResultSummary(null);
    setAnswers({});
    setRevealedAnswers({});
    setPracticeResults({});

    try {
      const params = { topic: selectedTopic, limit, mode };
      const res = await API.get("/user/quiz", { params });

      let questionsData = res.data;
      if(!Array.isArray(questionsData) && questionsData?.data){
        questionsData = questionsData.data;
      }

      
      if (!questionsData || !Array.isArray(questionsData) || questionsData.length === 0) {
        toast.error(`No questions found for topic "${selectedTopic}". Try uploading some questions first.`);
        setQuestions([]);
        return;
      }
      
      setQuestions(questionsData);
      setAnswers({});
      setRevealedAnswers({});
      setPracticeResults({});
      setActiveIndex(0);
      
      if (mode === "Exam") {
        setTimeLeft(initialMinutes);
        setRunning(true);
      } else {
        setRunning(false);
        setTimeLeft(0);
      }
    } catch (err) {
      console.error("Error fetching questions:", err);
      const errorMsg = err.response?.data?.message || err.message || "Failed to fetch questions.";
      toast.error(`Error: ${errorMsg}`);
      setQuestions([]);
    }
  };

  const handleSelect = (questionId, optionIndex) => {
    if (mode === "Exam" && submitted) return;
    if (mode === "Practice" && revealedAnswers[questionId]) return; 
    
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleTextAnswer = (questionId, value) => {
    if (mode === "Exam" && submitted) return;
    if (mode === "Practice" && revealedAnswers[questionId]) return;
    setAnswers(prev => ({ ...prev, [questionId]: value }));
  };

  const handleRevealAnswer = (questionId) => {
    if (mode !== "Practice") return;
    
    const question = questions.find(q => q._id === questionId);

    if(!question){
      toast.error("Question not found!");
      return;
    }

    const qType = (question.questionType || 'multiple-choice').toLowerCase();
    const isFillOrTheory = qType === 'fill-in-blank' || qType === 'fill-in-gap' || qType === 'theory' || qType === 'short-answer' || qType === 'essay';
    if (!isFillOrTheory && (question.correctAnswer === null || question.correctAnswer === undefined)) {
      toast.error("No Correct Answer available for this question.");
      return;
    }

    const selectedIndex = answers[questionId];
    
    // Check current revealed state BEFORE toggling
    const isCurrentlyRevealed = revealedAnswers[questionId];
    
    if (isCurrentlyRevealed) {
      // Hide the answer (doesn't consume a reveal)
      setRevealedAnswers(prev => ({ 
        ...prev, 
        [questionId]: false 
      }));
    } else {
      // Check reveal limit before revealing
      const revealsLimit = user?.limits?.revealsPerQuiz ?? 3;
      const currentReveals = Object.values(revealedAnswers).filter(Boolean).length;
      
      if (revealsLimit !== -1 && currentReveals >= revealsLimit) {
        toast.warning(`You've used all ${revealsLimit} reveals for this quiz. Upgrade your plan for more reveals.`);
        return;
      }

      // Reveal the answer - can reveal even without selecting
      const qType = question.questionType || 'multiple-choice';
      let isCorrect = false;
      if (qType === 'fill-in-blank') {
        const submitted = (typeof selectedIndex === 'string' ? selectedIndex : '').trim().toLowerCase();
        const expected = (question.blankAnswer || '').trim().toLowerCase();
        isCorrect = submitted.length > 0 && submitted === expected;
      } else if (qType === 'theory') {
        isCorrect = false;
      } else {
        isCorrect = selectedIndex !== undefined && typeof selectedIndex === 'number' && selectedIndex === question.correctAnswer;
      }
      
      // Set practice results FIRST
      setPracticeResults(prev => ({
        ...prev,
        [questionId]: {
          isCorrect,
          correctAnswer: question.correctAnswer,
          selectedIndex: typeof selectedIndex === 'number' ? selectedIndex : null,
          selectedText: typeof selectedIndex === 'string' ? selectedIndex : null
        }
      }));
      
      // Then reveal
      setRevealedAnswers(prev => ({ 
        ...prev, 
        [questionId]: true 
      }));
    }
  };

  const handleSubmit = async () => {
    if (submitted) return;
    setRunning(false);
    clearInterval(timerRef.current);

    const payloadAnswers = (questions || []).map(q => {
      const val = answers[q._id];
      const qType = q.questionType || 'multiple-choice';
      if (qType === 'fill-in-blank' || qType === 'theory') {
        return {
          questionId: q._id,
          questionType: qType,
          selectedIndex: null,
          selectedText: typeof val === 'string' ? val : null
        };
      }
      return {
        questionId: q._id,
        questionType: qType,
        selectedIndex: typeof val === 'number' ? val : null,
        selectedText: null
      };
    });

    const timeSpent = (initialMinutes - timeLeft) * 60;

    try {
      if (mode === "Exam") {
        const res = await API.post("/user/submit-exam", {
          topic: selectedTopic,
          difficulty: "",
          answers: payloadAnswers,
          timeSpentSeconds: timeSpent,
          mode: 'exam'
        });

        const responseData = res.data?.data || res.data;

        if (res.data?.success && responseData) {
          setResultSummary({
            correctCount: responseData.correctCount,
            total: responseData.total,
            percentage: responseData.percentage,
            answers: responseData.answers
          });
          setShowScorePopup(true);
        } else {
          toast.error("Submission returned an unexpected response.");
          console.error("Unexpected response format:", res.data);
        }
      } else {
        // Practice mode: submit to backend marked as practice
        try {
          const res = await API.post("/user/submit-exam", {
            topic: selectedTopic,
            difficulty: "",
            answers: payloadAnswers,
            timeSpentSeconds: timeSpent,
            mode: 'practice'
          });

          const responseData = res.data?.data || res.data;

          if (res.data?.success && responseData) {
            setResultSummary({
              correctCount: responseData.correctCount,
              total: responseData.total,
              percentage: responseData.percentage,
              answers: responseData.answers
            });
          } else {
            // Fallback to local calculation if server fails
            const correctCount = payloadAnswers.reduce((count, answer) => {
              const question = questions.find(q => q._id === answer.questionId);
              if (!question) return count;
              const qType = question.questionType || 'multiple-choice';
              if (qType === 'fill-in-blank') {
                const submitted = (answer.selectedText || '').trim().toLowerCase();
                const expected = (question.blankAnswer || '').trim().toLowerCase();
                return count + (submitted.length > 0 && submitted === expected ? 1 : 0);
              }
              if (qType === 'theory') return count;
              return count + (answer.selectedIndex === question?.correctAnswer ? 1 : 0);
            }, 0);
            
            setResultSummary({
              correctCount,
              total: questions.length,
              percentage: Math.round((correctCount / questions.length) * 100),
              answers: payloadAnswers.map(answer => {
                const question = questions.find(q => q._id === answer.questionId);
                const qType = question?.questionType || 'multiple-choice';
                let isCorrect = false;
                if (qType === 'fill-in-blank') {
                  const submitted = (answer.selectedText || '').trim().toLowerCase();
                  const expected = (question?.blankAnswer || '').trim().toLowerCase();
                  isCorrect = submitted.length > 0 && submitted === expected;
                } else if (qType !== 'theory') {
                  isCorrect = answer.selectedIndex === question?.correctAnswer;
                }
                return { ...answer, isCorrect };
              })
            });
          }
        } catch (practiceErr) {
          console.error("Practice submit error (falling back to local):", practiceErr);
          // Fallback: calculate locally if API fails
          const correctCount = payloadAnswers.reduce((count, answer) => {
            const question = questions.find(q => q._id === answer.questionId);
            if (!question) return count;
            const qType = question.questionType || 'multiple-choice';
            if (qType === 'fill-in-blank') {
              const submitted = (answer.selectedText || '').trim().toLowerCase();
              const expected = (question.blankAnswer || '').trim().toLowerCase();
              return count + (submitted.length > 0 && submitted === expected ? 1 : 0);
            }
            if (qType === 'theory') return count;
            return count + (answer.selectedIndex === question?.correctAnswer ? 1 : 0);
          }, 0);
          
          setResultSummary({
            correctCount,
            total: questions.length,
            percentage: Math.round((correctCount / questions.length) * 100),
            answers: payloadAnswers.map(answer => {
              const question = questions.find(q => q._id === answer.questionId);
              const qType = question?.questionType || 'multiple-choice';
              let isCorrect = false;
              if (qType === 'fill-in-blank') {
                const submitted = (answer.selectedText || '').trim().toLowerCase();
                const expected = (question?.blankAnswer || '').trim().toLowerCase();
                isCorrect = submitted.length > 0 && submitted === expected;
              } else if (qType !== 'theory') {
                isCorrect = answer.selectedIndex === question?.correctAnswer;
              }
              return { ...answer, isCorrect };
            })
          });
        }
        setShowScorePopup(true);
      }
    } catch (err) {
      console.error("Submit error:", err);
      toast.error("Failed to submit exam.");
    } finally {
      setSubmitted(true);
    }
  };

  const resetQuiz = () => {
    setQuestions([]);
    setAnswers({});
    setRevealedAnswers({});
    setPracticeResults({});
    setSubmitted(false);
    setResultSummary(null);
    setShowScorePopup(false);
    setRunning(false);
    setTimeLeft(0);
    setActiveIndex(0);
    clearInterval(timerRef.current);
  };

  const closeScorePopup = () => {
    setShowScorePopup(false);
  };

  // Generate AI study suggestions based on quiz results
  const generateStudySuggestions = async () => {
    if (!resultSummary || !selectedTopic) return;
    
    setLoadingSuggestions(true);
    try {
      const wrongAnswers = resultSummary.answers.filter(a => !a.isCorrect);
      
      // Extract key concepts from questions for contextual tips
      const questionConcepts = questions.slice(0, 5).map(q => {
        // Get first meaningful words from question
        const words = q.questionText.split(' ').filter(w => w.length > 4);
        return words.slice(0, 3).join(' ');
      }).join(', ');

      const prompt = `I just completed a ${selectedTopic} quiz and scored ${resultSummary.percentage}% (${resultSummary.correctCount} out of ${resultSummary.total} questions correct).

The material covered topics like: ${questionConcepts}

${wrongAnswers.length > 0 ? `I struggled with questions about: ${wrongAnswers.map((a, i) => {
  const q = questions.find(qu => qu._id === a.questionId);
  if (!q) return '';
  // Extract key concept from the question
  const words = q.questionText.split(' ').filter(w => w.length > 5);
  return words.slice(0, 2).join(' ');
}).filter(Boolean).join(', ')}` : ''}

Can you give me personalized study tips to improve my understanding of ${selectedTopic}? Please reference the concepts I studied and provide specific strategies. Write naturally without markdown formatting or bullet points.`;

      const response = await aiChat([{ role: 'user', content: prompt }], 'academic');
      setAiSuggestions(response.content);
    } catch (error) {
      console.error('Error generating AI suggestions:', error);
      setAiSuggestions('Focus on reviewing the material regularly. Break down complex topics into smaller parts and practice with similar questions to reinforce your understanding.');
    } finally {
      setLoadingSuggestions(false);
    }
  };


  const handleAIHelp = async () => {
    // Block AI features when offline
    if (!isOnline) {
      toast.warning("AI features require internet connection. Please connect to use this feature.");
      return;
    }

  };

  const goToQuestion = (index) => {
    if (index < 0 || index >= questions.length) return;
    setActiveIndex(index);
  };

  const handleEndSession = () => {
    if (submitted) return;
    handleSubmit();
  };

  const activeQuestion = questions[activeIndex];
  const answeredCount = Object.keys(answers).filter(id => {
    const v = answers[id];
    return v !== undefined && v !== null && v !== '';
  }).length;

  return (
    <div className="learning-container">
      <div className="learning-shell">
        <div className="learning-header">
          <div>
            <h2>Learn</h2>
            <p className="learning-subtitle">Stay focused with a clean, distraction-free quiz flow.</p>
          </div>
          {!isOnline && (
            <div className="offline-notice">
              AI features disabled while offline
            </div>
          )}
        </div>

        {questions.length === 0 && (
          <div className="learning-setup">
            <div className="topic-selection">
              <div className="control-group">
                <label>Mode</label>
                <select 
                  value={mode} 
                  onChange={(e) => setMode(e.target.value)}
                >
                  <option value="Exam">Exam</option>
                  <option value="Practice">Practice</option>
                </select>
              </div>

              <div className="control-group">
                <label>Topic</label>
                <select value={selectedTopic} onChange={(e) => setSelectedTopic(e.target.value)}>
                  <option value="">Select Topic</option>
                  {topics.map((t, i) => (
                    <option key={i} value={t}>{t}</option>
                  ))}
                </select>
              </div>

              <div className="control-group">
                <label>Questions</label>
                <input type="number" min="1" max="200" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
              </div>

              {mode === "Exam" && (
                <div className="control-group">
                  <label>Timer (min)</label>
                  <input type="number" min="0" max="120" value={initialMinutes} onChange={(e) => setInitialMinutes(Number(e.target.value))} />
                </div>
              )}
            </div>

            <div className="control-buttons">
              <button 
                className="btn-primary" 
                onClick={fetchQuestions}
                disabled={questions.length > 0 && !submitted}
              >
                Start Quiz
              </button>
              {/* {selectedTopic && user?.limits?.pdfExport && (
                <button
                  className="btn-secondary"
                  onClick={handleDownloadPDF}
                  disabled={downloadingPdf}
                  title="Download questions as PDF"
                >
                  <FiDownload size={16} />
                  {downloadingPdf ? 'Downloading...' : 'Download PDF'}
                </button>
              )} */}
            </div>
          </div>
        )}

        {questions.length > 0 && activeQuestion && (
          <div className="learning-quiz">
            <div className="learning-topbar">
              <div className="learning-topbar-item">
                {mode === "Exam" ? formatTime(timeLeft) : "Practice Mode"}
              </div>
              <div className="learning-topbar-item learning-counter">
                {activeIndex + 1} of {questions.length}
              </div>
              <div className="learning-topbar-actions">
                {submitted ? (
                  <button className="learning-end-newq" onClick={resetQuiz}>
                    Start New Quiz
                  </button>
                ) : (
                  <button className="learning-end" onClick={handleEndSession}>
                    {mode === "Exam" ? "End Exam" : "Finish Practice"}
                  </button>
                )}
              </div>
            </div>

            <div className="learning-number-strip">
              {questions.map((q, idx) => {
                const isAnswered = answers[q._id] !== undefined;
                let numberClass = "learning-number";
                if (idx === activeIndex) numberClass += " active";
                if (isAnswered) numberClass += " answered";
                return (
                  <button
                    key={q._id}
                    className={numberClass}
                    onClick={() => goToQuestion(idx)}
                    aria-current={idx === activeIndex ? "step" : undefined}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            <div className="learning-card">
              <div className="learning-card-header">
                <div className="learning-card-tags">
                  <span className="learning-tag">{formatQuestionType(activeQuestion.questionType)}</span>
                  <span className="learning-tag subtle">Question {activeIndex + 1}</span>
                </div>
                {mode === "Practice" && (
                  <button 
                    className={`reveal-btn ${revealedAnswers[activeQuestion._id] ? 'revealed' : ''}`}
                    onClick={() => handleRevealAnswer(activeQuestion._id)}
                    title={revealedAnswers[activeQuestion._id] ? "Hide Answer" : "Reveal Answer"}
                  >
                    {revealedAnswers[activeQuestion._id] ? <FiEyeOff /> : <FiEye />}
                  </button>
                )}
              </div>

              <div className="learning-question">
                {activeQuestion.questionText}
              </div>

              {/* ── Answer input — branch on question type ── */}
              {(() => {
                const qType = (activeQuestion.questionType || '').toLowerCase();
                const isFill = qType === 'fill-in-blank' || qType === 'fill-in-gap';
                const isTheoryType = qType === 'short-answer' || qType === 'essay' ||
                                 qType === 'theory' || qType === 'question';
                // Only treat as MCQ via options fallback if the type is not explicitly fill-in or theory
                const isMCQ = qType === 'multiple-choice' || qType === 'true-false' ||
                              (!isFill && !isTheoryType && activeQuestion.options && activeQuestion.options.length > 0);
                const isTheory = isTheoryType || (!isMCQ && !isFill);
                const isLocked = (mode === 'Exam' && submitted) ||
                                 (mode === 'Practice' && revealedAnswers[activeQuestion._id]);

                if (isMCQ) {
                  return (
                    <div className="learning-options">
                      {activeQuestion.options.map((opt, oi) => {
                        const selected = answers[activeQuestion._id];
                        const isRevealed = revealedAnswers[activeQuestion._id];
                        const practiceResult = practiceResults[activeQuestion._id];
                        let correctIndexFromServer = null;
                        if (submitted && resultSummary && Array.isArray(resultSummary.answers)) {
                          const a = resultSummary.answers.find(x => x.questionId === activeQuestion._id);
                          if (a) correctIndexFromServer = a.correctIndex;
                        }

                        let cls = 'learning-option';
                        if (mode === 'Practice' && isRevealed && practiceResult) {
                          if (oi === practiceResult.correctAnswer) cls += ' is-correct';
                          else if (selected === oi && selected !== practiceResult.correctAnswer) cls += ' is-wrong';
                        } else if (mode === 'Exam' && submitted) {
                          if (correctIndexFromServer !== null && oi === correctIndexFromServer) cls += ' is-correct';
                          else if (correctIndexFromServer !== null && selected === oi && oi !== correctIndexFromServer) cls += ' is-wrong';
                        }
                        if (selected === oi && !(mode === 'Practice' && isRevealed)) cls += ' is-selected';

                        return (
                          <button
                            key={`${activeQuestion._id}-${oi}`}
                            className={cls}
                            onClick={() => handleSelect(activeQuestion._id, oi)}
                            disabled={(mode === 'Exam' && submitted) || (mode === 'Practice' && isRevealed)}
                          >
                            <span className="learning-option-label">{String.fromCharCode(65 + oi)}</span>
                            <span className="learning-option-text">{opt.replace(/^[A-Da-d][.):\s]\s*/,'')}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                }

                // Resolve the correct answer text from resultSummary (exam) or question object (practice)
                const summaryEntry = resultSummary?.answers?.find(x => x.questionId === activeQuestion._id);
                const fillCorrect = summaryEntry?.correctText || activeQuestion.blankAnswer || null;
                const theoryCorrect = summaryEntry?.correctText || activeQuestion.modelAnswer || null;

                if (isFill) {
                  return (
                    <div className="learning-text-answer-wrap">
                      <input
                        type="text"
                        className={`learning-fill-input${isLocked ? ' locked' : ''}`}
                        placeholder="Type your answer here…"
                        value={typeof answers[activeQuestion._id] === 'string' ? answers[activeQuestion._id] : ''}
                        onChange={e => handleTextAnswer(activeQuestion._id, e.target.value)}
                        disabled={isLocked}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      {isLocked && fillCorrect && (
                        <div className="learning-model-answer">
                          <span className="learning-model-answer-label">Correct Answer:</span>
                          {fillCorrect}
                        </div>
                      )}
                    </div>
                  );
                }

                // Theory / essay
                return (
                  <div className="learning-text-answer-wrap">
                    <textarea
                      className={`learning-theory-textarea${isLocked ? ' locked' : ''}`}
                      placeholder="Write your answer here…"
                      value={typeof answers[activeQuestion._id] === 'string' ? answers[activeQuestion._id] : ''}
                      onChange={e => handleTextAnswer(activeQuestion._id, e.target.value)}
                      disabled={isLocked}
                      rows={6}
                    />
                    {!isLocked && (
                      <div className="learning-word-count">
                        {typeof answers[activeQuestion._id] === 'string'
                          ? answers[activeQuestion._id].trim().split(/\s+/).filter(Boolean).length
                          : 0} words
                      </div>
                    )}
                    {isLocked && theoryCorrect && (
                      <div className="learning-model-answer">
                        <span className="learning-model-answer-label">Model Answer:</span>
                        {theoryCorrect}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="learning-footer-nav">
              <button
                className="nav-btn"
                onClick={() => goToQuestion(activeIndex - 1)}
                disabled={activeIndex === 0}
              >
                Previous
              </button>
              <div className="learning-progress">
                Answered {answeredCount} / {questions.length}
              </div>
              {activeIndex === questions.length - 1 && !submitted ? (
                <button
                  className="nav-btn"
                  onClick={handleSubmit}
                >
                  Submit
                </button>
              ) : (
                <button
                  className="nav-btn"
                  onClick={() => goToQuestion(activeIndex + 1)}
                  disabled={activeIndex === questions.length - 1}
                >
                  Next
                </button>
              )}
            </div>

            {mode === "Practice" && (
              <div className="practice-controls">
                <div className="practice-progress">
                  <span className="progress-text">
                    Revealed: {Object.keys(revealedAnswers).filter(id => revealedAnswers[id]).length} / {
                      (user?.limits?.revealsPerQuiz === -1) 
                        ? questions.length 
                        : Math.min(user?.limits?.revealsPerQuiz ?? 3, questions.length)
                    }
                    {user?.limits?.revealsPerQuiz !== -1 && (
                      <span className="reveal-limit-hint"> (limit: {user?.limits?.revealsPerQuiz ?? 3})</span>
                    )}
                  </span>
                  <div className="progress-bar">
                    <div 
                      className="progress-fill" 
                      style={{
                        width: `${(Object.keys(revealedAnswers).filter(id => revealedAnswers[id]).length / questions.length) * 100}%`
                      }}
                    />
                  </div>
                </div>
                <div className="practice-actions">
                  <button 
                    className="btn-secondary"
                    onClick={() => {
                      const revealsLimit = user?.limits?.revealsPerQuiz ?? 3;
                      const currentReveals = Object.values(revealedAnswers).filter(Boolean).length;
                      const allRevealed = {};
                      let revealCount = currentReveals;
                      
                      questions.forEach(q => {
                        if (answers[q._id] !== undefined && !revealedAnswers[q._id]) {
                          if (revealsLimit !== -1 && revealCount >= revealsLimit) return;
                          
                          allRevealed[q._id] = true;
                          revealCount++;
                          const qType = (q.questionType || 'multiple-choice').toLowerCase();
                          let isCorrect = false;
                          if (qType === 'fill-in-blank' || qType === 'fill-in-gap') {
                            const submitted = (typeof answers[q._id] === 'string' ? answers[q._id] : '').trim().toLowerCase();
                            const expected = (q.blankAnswer || '').trim().toLowerCase();
                            isCorrect = submitted.length > 0 && submitted === expected;
                          } else if (qType === 'theory' || qType === 'short-answer' || qType === 'essay') {
                            isCorrect = false;
                          } else {
                            isCorrect = answers[q._id] === q.correctAnswer;
                          }
                          setPracticeResults(prev => ({
                            ...prev,
                            [q._id]: {
                              isCorrect,
                              correctAnswer: q.correctAnswer,
                              selectedIndex: typeof answers[q._id] === 'number' ? answers[q._id] : null,
                              selectedText: typeof answers[q._id] === 'string' ? answers[q._id] : null
                            }
                          }));
                        } else if (revealedAnswers[q._id]) {
                          allRevealed[q._id] = true;
                        }
                      });
                      setRevealedAnswers(prev => ({ ...prev, ...allRevealed }));
                      
                      if (revealsLimit !== -1 && revealCount >= revealsLimit) {
                        toast.info(`Reveal limit reached (${revealsLimit} per quiz).`);
                      }
                    }}
                    disabled={Object.keys(answers).length === 0}
                  >
                    Reveal All Answers
                  </button>
                  <button 
                    className="btn-primary"
                    onClick={handleSubmit}
                    disabled={submitted}
                  >
                    {submitted ? 'Submitted' : 'Submit Practice Quiz'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Score Popup */}
      {showScorePopup && resultSummary && (
        <div className="score-popup-overlay" onClick={closeScorePopup}>
          <div className="score-popup" onClick={(e) => e.stopPropagation()}>
            <div className="score-header">
              <h3>Quiz Results</h3>
              <button className="close-btn" onClick={closeScorePopup}><FiX/></button>
            </div>
            <div className="score-content">
              <div className="score-circle">
                <div className="score-percentage">{resultSummary.percentage}%</div>
                <div className="score-fraction">{resultSummary.correctCount}/{resultSummary.total}</div>
              </div>
              <div className="score-details">
                <p><strong>Mode:</strong> {mode} {mode === 'Practice' && <span className="practice-badge">Practice</span>}</p>
                <p><strong>Topic:</strong> {selectedTopic}</p>
                {mode === "Exam" && (
                  <p><strong>Time Spent:</strong> {formatTime(initialMinutes - timeLeft)}</p>
                )}
                {mode === "Practice" && (
                  <div className="practice-summary">
                    <p className="practice-note">Practice results help you learn!</p>
                    <p><strong>Questions Attempted:</strong> {Object.keys(revealedAnswers).filter(id => revealedAnswers[id]).length}</p>
                    {resultSummary.percentage >= 80 && (
                      <p className="encouragement">Great job! You're mastering this topic!  </p>
                    )}
                    {resultSummary.percentage >= 60 && resultSummary.percentage < 80 && (
                      <p className="encouragement">Good progress! Keep practicing to improve!  </p>
                    )}
                    {resultSummary.percentage < 60 && (
                      <p className="encouragement">Keep going! Review the material and try again!  </p>
                    )}
                  </div>
                )}
              </div>
              <div className="score-actions">
                <button className="btn-primary" onClick={closeScorePopup}>Close</button>
                <button className="btn-secondary" onClick={resetQuiz}>Start New Quiz</button>
                <button 
                  className="btn-ai" 
                  onClick={generateStudySuggestions}
                  disabled={loadingSuggestions || !isOnline}
                  title={!isOnline ? "AI features require internet connection" : "Get personalized study tips"}
                >
                  {loadingSuggestions ? 'Generating...' : 'AI Study Tips'}
                </button>
              </div>
              
              {aiSuggestions && (
                <div className="ai-suggestions">
                  <h4>AI Study Suggestions</h4>
                  <div className="suggestions-content">
                    {aiSuggestions.split('\n').map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
