/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { 
  BookOpen, 
  GraduationCap, 
  LayoutDashboard, 
  PlusCircle, 
  LogOut, 
  Send, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  ChevronRight, 
  Clock, 
  BarChart3,
  FileText,
  Download,
  Upload,
  Search,
  BrainCircuit,
  Lock,
  ArrowLeft,
  Trophy,
  Filter,
  Mic,
  Globe,
  User,
  ShieldCheck,
  Trash2,
  Eye,
  EyeOff,
  Save,
  Users,
  Bot,
  Flame
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  updateDoc, 
  deleteDoc,
  serverTimestamp,
  getDocs,
  where,
  getDoc,
  setDoc,
  increment,
  getDocFromServer
} from 'firebase/firestore';
import { signInWithPopup, onAuthStateChanged, signOut, User as FirebaseUser } from 'firebase/auth';
import { db, auth, googleProvider } from './firebase';
import { getAIHelp, searchAgent } from './services/geminiService';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// Set worker source for pdfjs
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs`;

// --- Types ---
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. ");
    }
    // Skip logging for other errors, as this is simply a connection test.
  }
}
testConnection();

interface Question {
  text: string;
  type: 'multiple-choice' | 'short-answer';
  options: string[];
  answer: string;
}

interface Assignment {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'Dễ' | 'Trung bình' | 'Khó';
  content: string;
  questions: Question[];
  knowledgeBase: string;
  createdAt: any;
}

interface Submission {
  id: string;
  studentName: string;
  studentEmail: string;
  studentClass: string;
  assignmentId: string;
  assignmentTitle: string;
  score: number;
  completionTime: number; // in seconds
  answers: { questionIndex: number; studentAnswer: string; isCorrect: boolean }[];
  timestamp: any;
  attemptCount: number;
}

interface ChatMessage {
  role: 'user' | 'ai';
  text: string;
}

interface UserProfile {
  userId: string;
  displayName: string;
  email: string;
  points: number;
  rank: 'Đồng' | 'Bạc' | 'Vàng';
  streak: number;
  studentClass?: string;
  lastActive: any;
}

interface SpeedrunQuestion {
  id: string;
  text: string;
  answer: string;
  category: string;
}

// --- Components ---

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [adminActiveTab, setAdminActiveTab] = useState<'overview' | 'assignments' | 'results' | 'ai_teaching'>('overview');
  const [globalKnowledgeBase, setGlobalKnowledgeBase] = useState('');
  const [role, setRole] = useState<'home' | 'admin' | 'student' | 'speedrun'>(() => {
    return (localStorage.getItem('app_role') as any) || 'home';
  });
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => {
    return localStorage.getItem('admin_logged_in') === 'true';
  });
  const [adminPassword, setAdminPassword] = useState('');
  const [srForm, setSrForm] = useState({ text: '', answer: '', category: 'Tác giả' });
  
  const [showRankLeaderboard, setShowRankLeaderboard] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [allProfiles, setAllProfiles] = useState<UserProfile[]>([]);
  
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [speedrunQuestions, setSpeedrunQuestions] = useState<SpeedrunQuestion[]>([]);
  
  const [activeAssignment, setActiveAssignment] = useState<Assignment | null>(null);
  const [studentClass, setStudentClass] = useState(() => localStorage.getItem('student_class') || '');
  const [isTakingQuiz, setIsTakingQuiz] = useState(false);
  const [quizStartTime, setQuizStartTime] = useState<number | null>(null);
  const [currentAnswers, setCurrentAnswers] = useState<string[]>([]);
  const [quizResult, setQuizResult] = useState<Submission | null>(null);
  
  const [showAIChat, setShowAIChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);

  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);

  const [showStreakPopup, setShowStreakPopup] = useState(false);
  const [streakCount, setStreakCount] = useState(0);

  const [showSearchAgent, setShowSearchAgent] = useState(false);
  const [searchChatMessages, setSearchChatMessages] = useState<ChatMessage[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [isSearchLoading, setIsSearchLoading] = useState(false);

  // Speed Run State
  const [isSpeedRunActive, setIsSpeedRunActive] = useState(false);
  const [speedRunTime, setSpeedRunTime] = useState(60);
  const [speedRunScore, setSpeedRunScore] = useState(0);
  const [currentSpeedQuestion, setCurrentSpeedQuestion] = useState<SpeedrunQuestion | null>(null);
  const [speedInput, setSpeedInput] = useState('');

  const [categoryFilter, setCategoryFilter] = useState('Tất cả');
  const [difficultyFilter, setDifficultyFilter] = useState('Tất cả');
  const [leaderboardAssignmentId, setLeaderboardAssignmentId] = useState<string | null>(null);
  const [adminClassFilter, setAdminClassFilter] = useState('Tất cả');
  const [selectedSubmission, setSelectedSubmission] = useState<Submission | null>(null);
  const [newAssignment, setNewAssignment] = useState<Partial<Assignment>>({
    title: '',
    description: '',
    content: '',
    questions: [],
    knowledgeBase: ''
  });

  const syncProfile = async (u: FirebaseUser) => {
    const profileRef = doc(db, 'profiles', u.uid);
    const profileSnap = await getDoc(profileRef);
    if (!profileSnap.exists()) {
      const newProfile: UserProfile = {
        userId: u.uid,
        displayName: u.displayName || 'Học sinh',
        email: u.email || '',
        points: 0,
        rank: 'Đồng',
        streak: 0,
        lastActive: serverTimestamp(),
        studentClass: studentClass
      };
      await setDoc(profileRef, newProfile);
      setProfile({ ...newProfile, lastActive: new Date() });
    } else {
      const data = profileSnap.data() as UserProfile;
      setProfile(data);
      if (studentClass && data.studentClass !== studentClass) {
        await updateDoc(profileRef, { studentClass });
      }
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      if (u) {
        syncProfile(u);
        // Load chat history
        const chatRef = doc(db, 'chats', u.uid);
        getDoc(chatRef).then(snap => {
          if (snap.exists()) {
            setChatMessages(snap.data().messages);
          }
        });
      } else {
        setProfile(null);
        setChatMessages([]);
      }
    });
    return () => unsubscribe();
  }, [studentClass]);

  useEffect(() => {
    const qAssignments = query(collection(db, 'assignments'), orderBy('createdAt', 'desc'));
    const unsubAssignments = onSnapshot(qAssignments, (snap) => {
      setAssignments(snap.docs.map(d => ({ id: d.id, ...d.data() } as Assignment)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'assignments'));

    const qProfiles = query(collection(db, 'profiles'), orderBy('points', 'desc'));
    const unsubProfiles = onSnapshot(qProfiles, (snap) => {
      setAllProfiles(snap.docs.map(d => ({ userId: d.id, ...d.data() } as UserProfile)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'profiles'));

    const qSpeedrun = query(collection(db, 'speedrunQuestions'));
    const unsubSpeedrun = onSnapshot(qSpeedrun, (snap) => {
      setSpeedrunQuestions(snap.docs.map(d => ({ id: d.id, ...d.data() } as SpeedrunQuestion)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'speedrunQuestions'));

    return () => {
      unsubAssignments();
      unsubProfiles();
      unsubSpeedrun();
    };
  }, []);

  useEffect(() => {
    if (!user) {
      setSubmissions([]);
      return;
    }

    const qSubmissions = query(collection(db, 'submissions'), orderBy('timestamp', 'desc'));
    const unsubSubmissions = onSnapshot(qSubmissions, (snap) => {
      setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() } as Submission)));
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'submissions'));

    const kbRef = doc(db, 'config', 'global_kb');
    const unsubKB = onSnapshot(kbRef, (snap) => {
      if (snap.exists()) setGlobalKnowledgeBase(snap.data().content);
    }, (error) => handleFirestoreError(error, OperationType.GET, 'config/global_kb'));

    return () => {
      unsubSubmissions();
      unsubKB();
    };
  }, [user]);

  useEffect(() => {
    let timer: any;
    if (isSpeedRunActive && speedRunTime > 0) {
      timer = setInterval(() => setSpeedRunTime(prev => prev - 1), 1000);
    } else if (speedRunTime === 0 && isSpeedRunActive) {
      handleEndSpeedRun();
    }
    return () => clearInterval(timer);
  }, [isSpeedRunActive, speedRunTime]);

  const handleGoogleLogin = async (targetRole: 'student' | 'admin') => {
    try {
      await signInWithPopup(auth, googleProvider);
      setRole(targetRole);
      localStorage.setItem('app_role', targetRole);
    } catch (error) {
      console.error(error);
      alert('Lỗi đăng nhập Google');
    }
  };

  const handleAdminLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (adminPassword === 'admin123') {
      setIsAdminLoggedIn(true);
      localStorage.setItem('admin_logged_in', 'true');
      setAdminPassword('');
    } else {
      alert('Sai mật khẩu!');
    }
  };

  const handleLogout = () => {
    auth.signOut();
    setIsAdminLoggedIn(false);
    localStorage.removeItem('admin_logged_in');
    setRole('home');
    localStorage.setItem('app_role', 'home');
  };

  const handleAddAssignment = async () => {
    if (!newAssignment.title || !newAssignment.content || newAssignment.questions?.length === 0) {
      alert('Vui lòng điền đầy đủ thông tin bài tập!');
      return;
    }
    try {
      await addDoc(collection(db, 'assignments'), {
        ...newAssignment,
        createdAt: serverTimestamp()
      });
      setNewAssignment({ title: '', description: '', content: '', questions: [], knowledgeBase: '' });
      alert('Đã thêm bài tập!');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'assignments');
    }
  };

  const handleDeleteAssignment = async (id: string) => {
    if (!confirm('Bạn có chắc muốn xoá bài tập này?')) return;
    try {
      await deleteDoc(doc(db, 'assignments', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `assignments/${id}`);
    }
  };

  const handleSaveGlobalKB = async () => {
    try {
      await setDoc(doc(db, 'config', 'global_kb'), { content: globalKnowledgeBase });
      alert('Đã lưu hướng dẫn AI!');
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'config/global_kb');
    }
  };

  const handleStartQuiz = (assignment: Assignment) => {
    if (!user) {
      alert('Vui lòng đăng nhập!');
      return;
    }
    if (!studentClass) {
      alert('Vui lòng nhập lớp!');
      return;
    }
    setActiveAssignment(assignment);
    setCurrentAnswers(new Array(assignment.questions.length).fill(''));
    setIsTakingQuiz(true);
    setQuizStartTime(Date.now());
    setQuizResult(null);
  };

  const updateStreak = async () => {
    if (!user || !profile) return;
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const lastActiveDate = profile.lastActive?.toDate();
    const lastActiveStr = lastActiveDate ? lastActiveDate.toISOString().split('T')[0] : '';

    if (lastActiveStr === todayStr) return;

    let newStreak = (profile.streak || 0) + 1;
    const profileRef = doc(db, 'profiles', user.uid);
    
    try {
      await updateDoc(profileRef, {
        streak: newStreak,
        lastActive: serverTimestamp()
      });
      setStreakCount(newStreak);
      setShowStreakPopup(true);
      setProfile(prev => prev ? { ...prev, streak: newStreak, lastActive: now } : null);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `profiles/${user.uid}`);
    }
  };

  const handleSubmitQuiz = async () => {
    if (!activeAssignment || !quizStartTime || !user) return;

    const endTime = Date.now();
    const completionTime = Math.round((endTime - quizStartTime) / 1000);

    const results = activeAssignment.questions.map((q, idx) => {
      const isCorrect = currentAnswers[idx].trim().toLowerCase() === q.answer.trim().toLowerCase();
      return { questionIndex: idx, studentAnswer: currentAnswers[idx], isCorrect };
    });

    const correctCount = results.filter(r => r.isCorrect).length;
    const score = Math.round((correctCount / activeAssignment.questions.length) * 100);
    const pointsEarned = correctCount * 10;

    const attemptCount = submissions.filter(s => 
      s.studentEmail === user.email && 
      s.assignmentId === activeAssignment.id
    ).length + 1;

    const submissionData = {
      studentName: user.displayName || 'Học sinh',
      studentEmail: user.email || '',
      studentClass: studentClass,
      assignmentId: activeAssignment.id,
      assignmentTitle: activeAssignment.title,
      score,
      completionTime,
      answers: results,
      timestamp: serverTimestamp(),
      attemptCount
    };

    try {
      const docRef = await addDoc(collection(db, 'submissions'), submissionData);
      setQuizResult({ id: docRef.id, ...submissionData, timestamp: new Date() });
      setIsTakingQuiz(false);

      // Update Points & Rank
      const profileRef = doc(db, 'profiles', user.uid);
      const currentPoints = profile?.points || 0;
      const newPoints = currentPoints + pointsEarned;
      let newRank: 'Đồng' | 'Bạc' | 'Vàng' = 'Đồng';
      if (newPoints >= 1500) newRank = 'Vàng';
      else if (newPoints >= 500) newRank = 'Bạc';

      if (newRank !== profile?.rank && profile) {
        alert(`Chúc mừng! Bạn đã thăng hạng lên ${newRank}! 🏆`);
      }

      try {
        await updateDoc(profileRef, {
          points: increment(pointsEarned),
          rank: newRank
        });
        setProfile(prev => prev ? { ...prev, points: prev.points + pointsEarned, rank: newRank } : null);
        await updateStreak();
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `profiles/${user.uid}`);
      }

    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'submissions');
    }
  };

  const handleStartSpeedRun = () => {
    if (speedrunQuestions.length === 0) {
      alert('Chưa có câu hỏi Speed Run nào!');
      return;
    }
    setIsSpeedRunActive(true);
    setSpeedRunTime(60);
    setSpeedRunScore(0);
    setNextSpeedQuestion();
  };

  const setNextSpeedQuestion = () => {
    const randomIdx = Math.floor(Math.random() * speedrunQuestions.length);
    setCurrentSpeedQuestion(speedrunQuestions[randomIdx]);
    setSpeedInput('');
  };

  const handleSpeedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentSpeedQuestion) return;

    if (speedInput.trim().toLowerCase() === currentSpeedQuestion.answer.toLowerCase()) {
      setSpeedRunScore(prev => prev + 1);
    }
    setNextSpeedQuestion();
  };

  const handleEndSpeedRun = async () => {
    setIsSpeedRunActive(false);
    if (user && speedRunScore > 0) {
      const pointsEarned = speedRunScore * 5;
      const profileRef = doc(db, 'profiles', user.uid);
      try {
        await updateDoc(profileRef, { points: increment(pointsEarned) });
        await updateStreak();
        alert(`Hết giờ! Bạn đạt ${speedRunScore} câu đúng, nhận được ${pointsEarned} điểm!`);
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, `profiles/${user.uid}`);
      }
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: 'assignment' | 'answer' | 'speedrun' | 'global_kb' | 'assignment_kb') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const extension = file.name.split('.').pop()?.toLowerCase();
    const reader = new FileReader();

    if (extension === 'txt') {
      reader.onload = async (event) => {
        const text = event.target?.result as string;
        if (type === 'assignment') {
          setNewAssignment(prev => ({ ...prev, content: text }));
        } else if (type === 'global_kb') {
          setGlobalKnowledgeBase(text);
        } else if (type === 'assignment_kb') {
          setNewAssignment(prev => ({ ...prev, knowledgeBase: text }));
        } else if (type === 'answer') {
          const lines = text.split('\n');
          const updatedQuestions = [...(newAssignment.questions || [])];
          lines.forEach((line, idx) => {
            if (updatedQuestions[idx]) {
              const parts = line.split('.');
              const ans = parts.length > 1 ? parts[1].trim() : line.trim();
              updatedQuestions[idx].answer = ans;
            }
          });
          setNewAssignment(prev => ({ ...prev, questions: updatedQuestions }));
        } else if (type === 'speedrun') {
          const lines = text.split('\n');
          for (const line of lines) {
            const [qText, qAns, qCat] = line.split('|');
            if (qText && qAns) {
              try {
                await addDoc(collection(db, 'speedrunQuestions'), {
                  text: qText.trim(),
                  answer: qAns.trim(),
                  category: qCat?.trim() || 'Tác giả'
                });
              } catch (error) {
                handleFirestoreError(error, OperationType.CREATE, 'speedrunQuestions');
              }
            }
          }
          alert('Đã tải lên câu hỏi Speed Run!');
        }
      };
      reader.readAsText(file);
    } else if (extension === 'docx' || extension === 'doc') {
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          const result = await mammoth.extractRawText({ arrayBuffer });
          const text = result.value;
          if (type === 'assignment') {
            setNewAssignment(prev => ({ ...prev, content: text }));
          } else if (type === 'global_kb') {
            setGlobalKnowledgeBase(text);
          } else if (type === 'assignment_kb') {
            setNewAssignment(prev => ({ ...prev, knowledgeBase: text }));
          } else {
            alert('File .docx chỉ hỗ trợ tải nội dung văn bản!');
          }
        } catch (err) {
          console.error('Error parsing docx:', err);
          alert('Lỗi khi đọc file .docx');
        }
      };
      reader.readAsArrayBuffer(file);
    } else if (extension === 'pdf') {
      reader.onload = async (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        try {
          const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
          let fullText = '';
          for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map((item: any) => item.str).join(' ');
            fullText += pageText + '\n';
          }
          if (type === 'assignment') {
            setNewAssignment(prev => ({ ...prev, content: fullText }));
          } else if (type === 'global_kb') {
            setGlobalKnowledgeBase(fullText);
          } else if (type === 'assignment_kb') {
            setNewAssignment(prev => ({ ...prev, knowledgeBase: fullText }));
          } else {
            alert('File .pdf chỉ hỗ trợ tải nội dung văn bản!');
          }
        } catch (err) {
          console.error('Error parsing pdf:', err);
          alert('Lỗi khi đọc file .pdf');
        }
      };
      reader.readAsArrayBuffer(file);
    } else {
      alert('Định dạng file không được hỗ trợ! Vui lòng dùng .txt, .doc, .docx hoặc .pdf');
    }
  };

  const handleAIChat = async () => {
    if (!chatInput.trim() || !user) return;
    
    const userMsg: ChatMessage = { role: 'user', text: chatInput };
    const newMessages = [...chatMessages, userMsg];
    setChatMessages(newMessages);
    setChatInput('');
    setIsAiLoading(true);

    try {
      let context = '';
      let questionText = '';
      let studentAnswer = '';
      let correctAnswer = '';
      let kb = '';

      if (activeAssignment && quizResult) {
        const wrongAnswer = quizResult.answers.find(a => !a.isCorrect);
        const question = wrongAnswer ? activeAssignment.questions[wrongAnswer.questionIndex] : activeAssignment.questions[0];
        questionText = question.text;
        studentAnswer = wrongAnswer?.studentAnswer || '';
        correctAnswer = question.answer;
        context = activeAssignment.content;
        kb = activeAssignment.knowledgeBase || '';
      } else {
        // General chat mode
        questionText = chatInput;
        // Combine KBs from all assignments and global KB for general context
        kb = [globalKnowledgeBase, ...assignments.map(a => a.knowledgeBase)].filter(Boolean).join('\n\n');
      }

      const aiResponse = await getAIHelp(
        questionText,
        studentAnswer,
        correctAnswer,
        context,
        kb,
        newMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }))
      );

      const finalMessages: ChatMessage[] = [...newMessages, { role: 'ai', text: aiResponse || 'Xin lỗi, mình gặp chút lỗi.' }];
      setChatMessages(finalMessages);
      
      // Save to Firestore
      const chatRef = doc(db, 'chats', user.uid);
      await setDoc(chatRef, { messages: finalMessages, updatedAt: serverTimestamp() });
    } catch (err) {
      console.error('AI Error:', err);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleGenerateQuestionsWithAI = async () => {
    if (!newAssignment.content) {
      alert('Vui lòng nhập nội dung bài đọc trước!');
      return;
    }
    setIsGeneratingQuestions(true);
    try {
      const prompt = `Dựa trên nội dung sau, hãy tạo 5 câu hỏi trắc nghiệm (multiple-choice) và 5 câu hỏi điền khuyết (short-answer). 
      Định dạng trả về là JSON array của các đối tượng { text: string, type: 'multiple-choice' | 'short-answer', options: string[], answer: string }.
      Nội dung: ${newAssignment.content}`;
      
      const response = await getAIHelp(prompt, '', '', '', '', []);
      // Extract JSON from response
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const generatedQuestions = JSON.parse(jsonMatch[0]);
        setNewAssignment(prev => ({ ...prev, questions: generatedQuestions }));
        alert('Đã tạo câu hỏi thành công!');
      } else {
        throw new Error('Không tìm thấy định dạng JSON trong phản hồi AI.');
      }
    } catch (err) {
      console.error('AI Generation Error:', err);
      alert('Lỗi khi tạo câu hỏi bằng AI. Vui lòng thử lại.');
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  const handleSearchAgent = async () => {
    if (!searchInput.trim()) return;
    
    const userMsg: ChatMessage = { role: 'user', text: searchInput };
    setSearchChatMessages(prev => [...prev, userMsg]);
    setSearchInput('');
    setIsSearchLoading(true);

    try {
      const aiResponse = await searchAgent(
        searchInput,
        searchChatMessages.map(m => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }))
      );
      setSearchChatMessages(prev => [...prev, { role: 'ai', text: aiResponse || 'Không tìm thấy thông tin.' }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSearchLoading(false);
    }
  };

  const getRankings = (assignmentId: string) => {
    return submissions
      .filter(s => s.assignmentId === assignmentId)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.completionTime - b.completionTime;
      })
      .slice(0, 10);
  };

  // --- UI Sections ---

  const renderHome = () => (
    <div className="min-h-screen soft-blue-gradient flex flex-col items-center justify-center p-6 overflow-hidden relative">
      {/* Animated Background Elements */}
      <motion.div 
        animate={{ 
          scale: [1, 1.2, 1],
          rotate: [0, 90, 0],
          opacity: [0.3, 0.5, 0.3]
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
        className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-200 rounded-full blur-3xl pointer-events-none"
      />
      <motion.div 
        animate={{ 
          scale: [1, 1.3, 1],
          rotate: [0, -90, 0],
          opacity: [0.2, 0.4, 0.2]
        }}
        transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
        className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-brand-300 rounded-full blur-3xl pointer-events-none"
      />

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-4xl w-full text-center space-y-12 relative z-10"
      >
        <div className="space-y-4">
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 20 }}
            className="w-24 h-24 bg-brand-600 rounded-3xl flex items-center justify-center mx-auto shadow-2xl shadow-brand-500/20 animate-float"
          >
            <BookOpen className="w-12 h-12 text-white" />
          </motion.div>
          <h1 className="text-6xl font-black tracking-tighter text-brand-900">
            Edu<span className="text-brand-600">Blue</span>
          </h1>
          <p className="text-xl text-brand-700 font-medium max-w-lg mx-auto">
            Nền tảng ôn tập đọc hiểu thông minh, cá nhân hóa cho thế hệ Gen Z.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8">
          <motion.button 
            whileHover={{ scale: 1.05, y: -5 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleGoogleLogin('student')}
            className="glass-card p-10 rounded-[2.5rem] text-left group transition-all hover:border-brand-400"
          >
            <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-brand-600 group-hover:text-white transition-colors">
              <GraduationCap className="w-8 h-8 text-brand-600 group-hover:text-white" />
            </div>
            <h2 className="text-3xl font-bold mb-2 text-brand-950">Học sinh</h2>
            <p className="text-brand-700">Luyện tập, thi đấu và nhận hỗ trợ từ AI 24/7.</p>
            <div className="mt-8 flex items-center gap-2 text-brand-600 font-bold">
              Bắt đầu ngay <ChevronRight className="w-5 h-5" />
            </div>
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05, y: -5 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => handleGoogleLogin('admin')}
            className="glass-card p-10 rounded-[2.5rem] text-left group transition-all hover:border-brand-400"
          >
            <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-brand-600 group-hover:text-white transition-colors">
              <ShieldCheck className="w-8 h-8 text-brand-600 group-hover:text-white" />
            </div>
            <h2 className="text-3xl font-bold mb-2 text-brand-950">Giáo viên</h2>
            <p className="text-brand-700">Quản lý bài tập, theo dõi tiến độ và dạy AI kiến thức.</p>
            <div className="mt-8 flex items-center gap-2 text-brand-600 font-bold">
              Quản trị hệ thống <ChevronRight className="w-5 h-5" />
            </div>
          </motion.button>
        </div>

        <div className="pt-12 flex items-center justify-center gap-12 text-brand-400 font-bold text-sm uppercase tracking-widest">
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> AI Powered</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Real-time</div>
          <div className="flex items-center gap-2"><CheckCircle2 className="w-4 h-4" /> Gamified</div>
        </div>
      </motion.div>
    </div>
  );

  const renderAdminLogin = () => (
    <div className="min-h-screen flex items-center justify-center soft-blue-gradient p-6">
      <motion.div 
        initial={{ opacity: 0, scale: 0.9, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="max-w-md w-full glass-card p-10 rounded-[2.5rem] shadow-2xl border border-white/20 relative overflow-hidden"
      >
        <div className="absolute top-0 left-0 w-full h-2 blue-gradient" />
        <div className="flex justify-center mb-8">
          <div className="w-20 h-20 bg-brand-100 rounded-3xl flex items-center justify-center shadow-inner">
            <Lock className="w-10 h-10 text-brand-600" />
          </div>
        </div>
        <h2 className="text-3xl font-black text-center mb-2 text-brand-900 tracking-tight">Quyền Quản trị</h2>
        <p className="text-center text-brand-500 mb-10 text-sm font-medium">Vui lòng xác thực để truy cập hệ thống EduBlue ✨</p>
        <form onSubmit={handleAdminLogin} className="space-y-6">
          <div className="relative group">
            <input 
              type={showPassword ? "text" : "password"} 
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              className="w-full px-6 py-4 rounded-2xl border border-brand-100 bg-white/50 focus:bg-white focus:ring-8 focus:ring-brand-500/5 outline-none transition-all font-bold placeholder:text-brand-300 pr-14"
              placeholder="Nhập mật khẩu quản trị..."
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-4 top-1/2 -translate-y-1/2 p-2 text-brand-400 hover:text-brand-600 transition-colors"
            >
              {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit"
            className="w-full py-5 blue-gradient text-white rounded-2xl font-black shadow-xl shadow-brand-500/20 transition-all"
          >
            Xác nhận truy cập
          </motion.button>
          <motion.button 
            whileHover={{ x: -5 }}
            onClick={() => { 
              signOut(auth).then(() => {
                setRole('home');
                setIsAdminLoggedIn(false);
                localStorage.removeItem('app_role');
                localStorage.removeItem('admin_logged_in');
              }).catch(err => {
                console.error('Sign Out Error:', err);
              });
            }}
            className="w-full py-4 text-brand-400 hover:text-brand-600 transition-all flex items-center justify-center gap-2 font-bold text-sm"
          >
            <ArrowLeft className="w-4 h-4" /> Quay lại trang chủ
          </motion.button>
        </form>
      </motion.div>
    </div>
  );

  const renderAdminDashboard = () => (
    <div className="min-h-screen soft-blue-gradient flex flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-72 glass-card border-r-0 md:border-r border-brand-200/30 p-8 flex flex-col relative z-20">
        <div className="flex items-center gap-4 mb-12">
          <motion.div 
            whileHover={{ rotate: 15 }}
            className="w-12 h-12 bg-brand-600 rounded-2xl flex items-center justify-center shadow-lg shadow-brand-500/20"
          >
            <BookOpen className="w-7 h-7 text-white" />
          </motion.div>
          <div>
            <span className="font-black text-2xl tracking-tighter text-brand-900">Edu<span className="text-brand-600">Blue</span></span>
            <div className="text-[10px] font-bold text-brand-400 uppercase tracking-widest">Admin Panel</div>
          </div>
        </div>
        
        <nav className="flex-1 space-y-3">
          {[
            { id: 'overview', label: 'Tổng quan', icon: LayoutDashboard },
            { id: 'assignments', label: 'Bài tập', icon: PlusCircle },
            { id: 'results', label: 'Kết quả', icon: BarChart3 },
            { id: 'ai_teaching', label: 'Dạy AI', icon: BrainCircuit },
          ].map((item) => (
            <motion.button 
              key={item.id}
              whileHover={{ x: 5 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setAdminActiveTab(item.id as any)} 
              className={`w-full flex items-center gap-4 px-5 py-4 rounded-2xl font-bold transition-all ${adminActiveTab === item.id ? 'bg-brand-600 text-white shadow-lg shadow-brand-500/30' : 'text-brand-500 hover:bg-brand-100/50'}`}
            >
              <item.icon className="w-5 h-5" /> {item.label}
            </motion.button>
          ))}
          <motion.button 
            whileHover={{ x: 5 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => setRole('speedrun')} 
            className="w-full flex items-center gap-4 px-5 py-4 text-brand-500 hover:bg-brand-100/50 rounded-2xl font-bold transition-all"
          >
            <Clock className="w-5 h-5" /> Speed Run
          </motion.button>
        </nav>

        <div className="pt-8 border-t border-brand-100/50 mt-8">
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => {
              signOut(auth).then(() => {
                setRole('home');
                setIsAdminLoggedIn(false);
                localStorage.removeItem('app_role');
                localStorage.removeItem('admin_logged_in');
              }).catch(err => {
                console.error('Sign Out Error:', err);
              });
            }}
            className="w-full flex items-center gap-4 px-5 py-4 text-red-500 hover:bg-red-50 rounded-2xl font-bold transition-all"
          >
            <LogOut className="w-5 h-5" /> Đăng xuất
          </motion.button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-6 md:p-12 overflow-y-auto relative z-10">
        <div className="max-w-6xl mx-auto space-y-10">
          <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
            <div>
              <h1 className="text-4xl font-black text-brand-900 tracking-tight">
                {adminActiveTab === 'overview' ? 'Hệ thống' : 
                 adminActiveTab === 'assignments' ? 'Quản lý Bài tập' : 
                 adminActiveTab === 'results' ? 'Kết quả Học sinh' : 'Huấn luyện AI'}
              </h1>
              <p className="text-brand-500 font-medium mt-1">Chào mừng trở lại, {user?.displayName} ✨</p>
            </div>
            <div className="flex items-center gap-4 bg-white/50 backdrop-blur-sm p-2 rounded-2xl border border-white/20">
              <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center font-bold text-brand-600">
                {user?.displayName?.[0]}
              </div>
              <div className="pr-4">
                <div className="text-xs font-bold text-brand-400 uppercase tracking-tighter">Admin</div>
                <div className="text-sm font-bold text-brand-900 leading-none">{user?.displayName}</div>
              </div>
            </div>
          </header>

          <AnimatePresence mode="wait">
            <motion.div
              key={adminActiveTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >

          {adminActiveTab === 'overview' && (
            <div className="space-y-10">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'Bài tập', value: assignments.length, icon: FileText, color: 'bg-blue-500' },
                  { label: 'Lượt nộp', value: submissions.length, icon: CheckCircle2, color: 'bg-emerald-500' },
                  { label: 'Học sinh', value: allProfiles.length, icon: Users, color: 'bg-amber-500' },
                  { label: 'Speed Run', value: speedrunQuestions.length, icon: Clock, color: 'bg-brand-600' },
                ].map((stat, i) => (
                  <motion.div 
                    key={i}
                    whileHover={{ y: -5 }}
                    className="glass-card p-6 flex items-center gap-5"
                  >
                    <div className={`w-14 h-14 ${stat.color} rounded-2xl flex items-center justify-center shadow-lg shadow-black/5`}>
                      <stat.icon className="w-7 h-7 text-white" />
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-brand-400 uppercase tracking-widest mb-1">{stat.label}</div>
                      <div className="text-3xl font-black text-brand-900 tracking-tighter">{stat.value}</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 glass-card p-8">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-2xl font-black text-brand-900 tracking-tight">Hoạt động gần đây</h3>
                    <button className="text-brand-600 font-bold text-sm hover:underline">Xem tất cả</button>
                  </div>
                  <div className="space-y-4">
                    {submissions.slice(0, 5).map((s, i) => (
                      <div key={s.id} className="flex items-center justify-between p-4 rounded-2xl bg-brand-50/50 border border-brand-100/50 hover:bg-brand-100/50 transition-colors">
                        <div className="flex items-center gap-4">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-brand-600 shadow-sm border border-brand-100">
                            {s.studentName[0]}
                          </div>
                          <div>
                            <div className="font-bold text-brand-900">{s.studentName}</div>
                            <div className="text-xs text-brand-400 font-medium">Vừa nộp bài: <span className="text-brand-600 font-bold">{s.assignmentTitle}</span></div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className={`text-lg font-black ${s.score >= 80 ? 'text-emerald-500' : s.score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                            {s.score}%
                          </div>
                          <div className="text-[10px] text-brand-400 font-bold uppercase tracking-widest">
                            {s.timestamp?.toDate?.().toLocaleDateString() || 'Vừa xong'}
                          </div>
                        </div>
                      </div>
                    ))}
                    {submissions.length === 0 && (
                      <div className="text-center py-12 text-brand-400 font-medium italic">
                        Chưa có lượt nộp bài nào.
                      </div>
                    )}
                  </div>
                </div>

                <div className="glass-card p-8">
                  <div className="flex items-center justify-between mb-8">
                    <h3 className="text-2xl font-black text-brand-900 tracking-tight">Lớp học</h3>
                  </div>
                  <div className="space-y-4">
                    {Array.from(new Set(submissions.map(s => s.studentClass))).map(cls => {
                      const count = submissions.filter(s => s.studentClass === cls).length;
                      return (
                        <div key={cls} className="flex justify-between items-center p-4 rounded-2xl bg-white/50 border border-brand-100/50">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-brand-100 rounded-lg flex items-center justify-center text-brand-600 font-bold text-xs">
                              {cls}
                            </div>
                            <span className="font-bold text-brand-900">Lớp {cls}</span>
                          </div>
                          <span className="px-3 py-1 bg-brand-600 text-white rounded-full text-[10px] font-black uppercase tracking-widest">
                            {count} lượt
                          </span>
                        </div>
                      );
                    })}
                    {submissions.length === 0 && (
                      <div className="text-center py-12 text-brand-400 font-medium italic">
                        Chưa có dữ liệu lớp học.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {adminActiveTab === 'assignments' && (
            <div className="space-y-10">
              {/* Add Assignment Form */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-10"
              >
                <div className="flex items-center gap-4 mb-10">
                  <div className="w-12 h-12 bg-brand-100 rounded-2xl flex items-center justify-center">
                    <PlusCircle className="w-7 h-7 text-brand-600" />
                  </div>
                  <h2 className="text-3xl font-black text-brand-900 tracking-tight">Tạo bài tập mới</h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-10">
                  <div className="md:col-span-1">
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest mb-2 ml-1">Tên bài tập</label>
                    <input 
                      type="text" 
                      value={newAssignment.title}
                      onChange={e => setNewAssignment({...newAssignment, title: e.target.value})}
                      className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                      placeholder="Tiêu đề..."
                    />
                  </div>
                  <div className="md:col-span-1">
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest mb-2 ml-1">Mô tả ngắn</label>
                    <input 
                      type="text" 
                      value={newAssignment.description}
                      onChange={e => setNewAssignment({...newAssignment, description: e.target.value})}
                      className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                      placeholder="Mô tả tóm tắt..."
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest mb-2 ml-1">Thể loại</label>
                    <select 
                      value={newAssignment.category}
                      onChange={e => setNewAssignment({...newAssignment, category: e.target.value})}
                      className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all appearance-none cursor-pointer"
                    >
                      <option>Đọc hiểu</option>
                      <option>Ngữ pháp</option>
                      <option>Văn học</option>
                      <option>Nghị luận</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest mb-2 ml-1">Độ khó</label>
                    <select 
                      value={newAssignment.difficulty}
                      onChange={e => setNewAssignment({...newAssignment, difficulty: e.target.value as any})}
                      className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all appearance-none cursor-pointer"
                    >
                      <option>Dễ</option>
                      <option>Trung bình</option>
                      <option>Khó</option>
                    </select>
                  </div>
                </div>

                <div className="mb-10">
                  <div className="flex justify-between items-center mb-4">
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest ml-1">Nội dung bài đọc</label>
                    <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 px-3 py-1.5 rounded-xl border border-brand-100 transition-all">
                      <Upload className="w-4 h-4" /> Tải file đề (.txt, .doc, .pdf)
                      <input type="file" accept=".txt,.doc,.docx,.pdf" onChange={e => handleFileUpload(e, 'assignment')} className="hidden" />
                    </label>
                  </div>
                  <textarea 
                    rows={6}
                    value={newAssignment.content}
                    onChange={e => setNewAssignment({...newAssignment, content: e.target.value})}
                    className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all min-h-[200px]"
                    placeholder="Dán nội dung văn bản hoặc tải file lên..."
                  />
                </div>

                <div className="mb-10">
                  <div className="flex justify-between items-center mb-4">
                    <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest ml-1">Tài liệu dạy AI (Knowledge Base)</label>
                    <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-xl border border-indigo-100 transition-all">
                      <Upload className="w-4 h-4" /> Tải file KB (.txt, .doc, .pdf)
                      <input type="file" accept=".txt,.doc,.docx,.pdf" onChange={e => handleFileUpload(e, 'assignment_kb')} className="hidden" />
                    </label>
                  </div>
                  <textarea 
                    rows={4}
                    value={newAssignment.knowledgeBase}
                    onChange={e => setNewAssignment({...newAssignment, knowledgeBase: e.target.value})}
                    className="w-full bg-brand-50/50 border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                    placeholder="Nhập thông tin bổ sung để AI hỗ trợ học sinh tốt hơn..."
                  />
                </div>

                <div className="flex justify-center mb-12">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleGenerateQuestionsWithAI}
                    disabled={isGeneratingQuestions}
                    className="px-8 py-4 bg-indigo-100 text-indigo-600 rounded-2xl font-black flex items-center gap-3 border-2 border-indigo-200 hover:bg-indigo-200 transition-all disabled:opacity-50"
                  >
                    <BrainCircuit className={`w-6 h-6 ${isGeneratingQuestions ? 'animate-spin' : ''}`} />
                    {isGeneratingQuestions ? 'ĐANG TẠO CÂU HỎI...' : 'TẠO CÂU HỎI BẰNG AI'}
                  </motion.button>
                </div>

                <div className="space-y-8 mb-12">
                  <div className="flex justify-between items-center">
                    <h3 className="text-2xl font-black text-brand-900 tracking-tight">Câu hỏi & Đáp án</h3>
                    <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-100 transition-all">
                      <Upload className="w-4 h-4" /> Tải file đáp án (.txt)
                      <input type="file" accept=".txt" onChange={e => handleFileUpload(e, 'answer')} className="hidden" />
                    </label>
                  </div>
                  <div className="grid grid-cols-1 gap-6">
                  {newAssignment.questions?.map((q, idx) => (
                    <motion.div 
                      key={idx}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="p-8 bg-brand-50/30 rounded-3xl border-2 border-brand-100/50 relative group"
                    >
                      <div className="absolute -top-4 -left-4 w-10 h-10 bg-brand-600 text-white rounded-xl flex items-center justify-center font-black shadow-lg shadow-brand-500/20">
                        {idx + 1}
                      </div>
                      <div className="grid gap-6">
                        <div className="flex flex-col md:flex-row gap-4">
                          <input 
                            type="text" 
                            value={q.text}
                            onChange={e => {
                              const qs = [...(newAssignment.questions || [])];
                              qs[idx].text = e.target.value;
                              setNewAssignment({...newAssignment, questions: qs});
                            }}
                            className="flex-1 bg-white border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                            placeholder={`Nhập câu hỏi ${idx + 1}...`}
                          />
                          <select 
                            value={q.type}
                            onChange={e => {
                              const qs = [...(newAssignment.questions || [])];
                              qs[idx].type = e.target.value as any;
                              setNewAssignment({...newAssignment, questions: qs});
                            }}
                            className="px-6 py-4 bg-white border-2 border-brand-100 rounded-2xl font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all appearance-none cursor-pointer"
                          >
                            <option value="short-answer">Điền khuyết</option>
                            <option value="multiple-choice">Trắc nghiệm</option>
                          </select>
                        </div>
                        
                        {q.type === 'multiple-choice' && (
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {q.options.map((opt, oIdx) => (
                              <div key={oIdx} className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 font-black text-brand-300 text-xs">
                                  {String.fromCharCode(65 + oIdx)}
                                </span>
                                <input 
                                  type="text"
                                  value={opt}
                                  onChange={e => {
                                    const qs = [...(newAssignment.questions || [])];
                                    qs[idx].options[oIdx] = e.target.value;
                                    setNewAssignment({...newAssignment, questions: qs});
                                  }}
                                  className="w-full bg-white border-2 border-brand-100 rounded-xl pl-10 pr-4 py-3 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all text-sm"
                                  placeholder={`Lựa chọn ${String.fromCharCode(65 + oIdx)}`}
                                />
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex flex-col md:flex-row gap-6 items-end md:items-center">
                          <div className="flex-1 w-full">
                            <label className="block text-[10px] font-black text-brand-400 uppercase tracking-widest mb-2 ml-1">Đáp án đúng</label>
                            <input 
                              type="text"
                              value={q.answer}
                              onChange={e => {
                                const qs = [...(newAssignment.questions || [])];
                                qs[idx].answer = e.target.value;
                                setNewAssignment({...newAssignment, questions: qs});
                              }}
                              className="w-full bg-white border-2 border-brand-100 rounded-2xl px-6 py-4 font-bold text-brand-900 focus:outline-none focus:border-brand-500 transition-all"
                              placeholder={q.type === 'multiple-choice' ? 'A' : 'Nhập đáp án đúng...'}
                            />
                          </div>
                          <button 
                            onClick={() => {
                              const qs = (newAssignment.questions || []).filter((_, i) => i !== idx);
                              setNewAssignment({...newAssignment, questions: qs});
                            }}
                            className="p-4 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-2xl transition-all"
                          >
                            <Trash2 className="w-6 h-6" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                  <motion.button 
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setNewAssignment(prev => ({...prev, questions: [...(prev.questions || []), { text: '', type: 'short-answer', options: ['', '', '', ''], answer: '' }] }))} 
                    className="w-full py-6 border-2 border-dashed border-brand-200 rounded-3xl text-brand-600 font-black flex items-center justify-center gap-3 hover:bg-brand-50 hover:border-brand-500 transition-all"
                  >
                    <PlusCircle className="w-5 h-5" /> THÊM CÂU HỎI MỚI
                  </motion.button>
                </div>
              </div>

              <div className="mb-8">
                  <label className="block text-sm font-medium text-stone-700 mb-2">Tài liệu dạy AI (Knowledge Base)</label>
                  <textarea 
                    rows={4}
                    value={newAssignment.knowledgeBase}
                    onChange={e => setNewAssignment({...newAssignment, knowledgeBase: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-stone-200 outline-none focus:ring-2 focus:ring-indigo-500"
                    placeholder="Nhập thông tin bổ sung để AI hỗ trợ học sinh tốt hơn..."
                  />
                </div>

                <motion.button 
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={handleAddAssignment}
                  className="w-full blue-gradient text-white font-black py-6 rounded-3xl shadow-2xl shadow-brand-500/40 flex items-center justify-center gap-4 text-xl"
                >
                  <PlusCircle className="w-8 h-8" /> TẠO BÀI TẬP NGAY
                </motion.button>
              </motion.div>

              {/* Assignments List */}
              <div className="space-y-8">
                <div className="flex items-center justify-between px-2">
                  <h3 className="text-3xl font-black text-brand-900 tracking-tight">Danh sách bài tập</h3>
                  <div className="flex items-center gap-3 bg-white/50 backdrop-blur-sm px-4 py-2 rounded-2xl border border-brand-100">
                    <div className="w-2 h-2 bg-brand-600 rounded-full animate-pulse" />
                    <span className="text-brand-600 font-black text-xs uppercase tracking-widest">{assignments.length} bài tập</span>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {assignments.map((assignment) => (
                    <motion.div 
                      key={assignment.id}
                      whileHover={{ y: -8 }}
                      className="glass-card p-8 group relative overflow-hidden border-2 border-transparent hover:border-brand-500 transition-all duration-500"
                    >
                      <div className="absolute top-0 right-0 w-40 h-40 bg-brand-100/30 rounded-full -mr-20 -mt-20 group-hover:scale-125 transition-transform duration-700" />
                      
                      <div className="relative z-10">
                        <div className="flex justify-between items-start mb-8">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 bg-brand-600 rounded-2xl flex items-center justify-center shadow-xl shadow-brand-500/30 group-hover:rotate-6 transition-transform">
                              <FileText className="w-7 h-7 text-white" />
                            </div>
                            <div>
                              <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest mb-1">{assignment.category}</div>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase tracking-tighter ${
                                  assignment.difficulty === 'Dễ' ? 'bg-emerald-100 text-emerald-600' :
                                  assignment.difficulty === 'Khó' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-600'
                                }`}>
                                  {assignment.difficulty}
                                </span>
                              </div>
                            </div>
                          </div>
                          <motion.button 
                            whileHover={{ scale: 1.1, rotate: 90 }}
                            whileTap={{ scale: 0.9 }}
                            onClick={() => handleDeleteAssignment(assignment.id)}
                            className="p-3 text-brand-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          >
                            <Trash2 className="w-6 h-6" />
                          </motion.button>
                        </div>
                        <h4 className="text-2xl font-black text-brand-900 mb-3 group-hover:text-brand-600 transition-colors">{assignment.title}</h4>
                        <p className="text-sm text-brand-500 font-medium line-clamp-2 mb-8 leading-relaxed">{assignment.description}</p>
                        <div className="flex items-center justify-between pt-8 border-t border-brand-100/50">
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-2">
                              {[1, 2, 3].map(i => (
                                <div key={i} className="w-6 h-6 rounded-full bg-brand-100 border-2 border-white flex items-center justify-center text-[8px] font-bold text-brand-600">
                                  {i}
                                </div>
                              ))}
                            </div>
                            <span className="text-[10px] font-black text-brand-400 uppercase tracking-widest">
                              {submissions.filter(s => s.assignmentId === assignment.id).length} lượt nộp
                            </span>
                          </div>
                          <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest">
                            {new Date(assignment.createdAt).toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {adminActiveTab === 'results' && (
            <div className="space-y-10">
              {/* Submissions Table */}
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card overflow-hidden"
              >
                <div className="p-8 border-b border-brand-100/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div>
                    <h2 className="text-3xl font-black text-brand-900 tracking-tight">Kết quả học sinh</h2>
                    <p className="text-brand-400 font-bold text-xs uppercase tracking-widest mt-1">Quản lý và theo dõi tiến độ</p>
                  </div>
                  <div className="flex items-center gap-4 bg-brand-50 p-2 rounded-2xl border border-brand-100">
                    <Filter className="w-5 h-5 text-brand-400 ml-2" />
                    <select 
                      value={adminClassFilter} 
                      onChange={e => setAdminClassFilter(e.target.value)}
                      className="bg-transparent px-4 py-2 rounded-xl outline-none font-bold text-brand-900 text-sm cursor-pointer"
                    >
                      <option>Tất cả lớp</option>
                      {Array.from(new Set(submissions.map(s => s.studentClass))).map(cls => (
                        <option key={cls} value={cls}>Lớp {cls}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-brand-50/50 text-brand-400 text-[10px] uppercase font-black tracking-widest">
                        <th className="px-8 py-6">Học sinh</th>
                        <th className="px-8 py-6">Lớp</th>
                        <th className="px-8 py-6">Bài tập</th>
                        <th className="px-8 py-6 text-center">Điểm số</th>
                        <th className="px-8 py-6">Thời gian</th>
                        <th className="px-8 py-6 text-right">Hành động</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-100/50">
                      {submissions
                        .filter(s => adminClassFilter === 'Tất cả' || adminClassFilter === 'Tất cả lớp' || s.studentClass === adminClassFilter)
                        .map((s) => (
                          <tr key={s.id} className="hover:bg-brand-50/30 transition-colors group">
                            <td className="px-8 py-6">
                              <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center font-black text-brand-600 shadow-sm border border-brand-100 group-hover:scale-110 transition-transform">
                                  {s.studentName[0]}
                                </div>
                                <div className="font-bold text-brand-900">{s.studentName}</div>
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <span className="px-3 py-1 bg-brand-50 text-brand-600 rounded-lg font-bold text-xs border border-brand-100">
                                {s.studentClass}
                              </span>
                            </td>
                            <td className="px-8 py-6">
                              <div className="font-bold text-brand-900 text-sm">{s.assignmentTitle}</div>
                            </td>
                            <td className="px-8 py-6 text-center">
                              <div className={`text-xl font-black ${s.score >= 80 ? 'text-emerald-500' : s.score >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
                                {s.score}%
                              </div>
                            </td>
                            <td className="px-8 py-6">
                              <div className="text-xs font-bold text-brand-400 uppercase tracking-tighter">
                                {s.timestamp?.toDate?.().toLocaleString() || 'Vừa xong'}
                              </div>
                            </td>
                            <td className="px-8 py-6 text-right">
                              <button 
                                onClick={() => setSelectedSubmission(s)}
                                className="p-2 text-brand-400 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition-all"
                              >
                                <Eye className="w-5 h-5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                  {submissions.length === 0 && (
                    <div className="text-center py-20">
                      <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-6">
                        <BarChart3 className="w-10 h-10 text-brand-200" />
                      </div>
                      <p className="text-brand-400 font-bold italic">Chưa có dữ liệu kết quả nào được ghi nhận.</p>
                    </div>
                  )}
                </div>
              </motion.div>
            </div>
          )}

          {adminActiveTab === 'ai_teaching' && (
            <div className="space-y-10">
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="glass-card p-10"
              >
                <div className="flex items-center gap-6 mb-10">
                  <div className="w-16 h-16 bg-brand-600 rounded-2xl flex items-center justify-center shadow-xl shadow-brand-500/30">
                    <BrainCircuit className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-3xl font-black text-brand-900 tracking-tight">Tài liệu dạy AI Hệ thống</h2>
                    <p className="text-brand-400 font-bold text-xs uppercase tracking-widest mt-1">Cấu hình kiến thức nền tảng cho AI</p>
                  </div>
                  <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-brand-600 hover:text-brand-700 bg-brand-50 px-4 py-2 rounded-xl border border-brand-100 transition-all">
                    <Upload className="w-4 h-4" /> Tải tài liệu (.txt, .doc, .pdf)
                    <input type="file" accept=".txt,.doc,.docx,.pdf" onChange={e => handleFileUpload(e, 'global_kb')} className="hidden" />
                  </label>
                </div>
                <div className="bg-brand-50/50 p-6 rounded-2xl border border-brand-100 mb-10">
                  <p className="text-brand-600 font-medium leading-relaxed">
                    Đây là tài liệu kiến thức chung mà AI sẽ sử dụng để hỗ trợ học sinh trong toàn bộ hệ thống. 
                    Bạn có thể nhập các quy tắc, phong cách giảng dạy, hoặc kiến thức nền tảng tại đây để AI có thể trả lời thông minh hơn.
                  </p>
                </div>

                <div className="relative group">
                  <div className="absolute -inset-1 bg-gradient-to-r from-brand-400 to-brand-600 rounded-3xl blur opacity-10 group-focus-within:opacity-25 transition-opacity" />
                  <textarea 
                    rows={15}
                    value={globalKnowledgeBase}
                    onChange={e => setGlobalKnowledgeBase(e.target.value)}
                    placeholder="Nhập kiến thức nền tảng cho AI tại đây..."
                    className="relative w-full bg-white border-2 border-brand-100 rounded-3xl px-8 py-8 outline-none focus:border-brand-500 transition-all font-medium text-brand-900 leading-relaxed placeholder:text-brand-200"
                  />
                </div>

                <div className="mt-10 flex justify-end">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleSaveGlobalKB}
                    className="px-10 py-5 bg-gradient-to-r from-brand-600 to-brand-500 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-brand-500/40 hover:shadow-brand-500/60 transition-all flex items-center gap-3"
                  >
                    <Save className="w-5 h-5" />
                    LƯU CẤU HÌNH AI
                  </motion.button>
                </div>
              </motion.div>
            </div>
          )}
          </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Submission Detail Modal */}
      <AnimatePresence>
        {selectedSubmission && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-6">
            <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="bg-white w-full max-w-3xl rounded-[40px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-8 bg-indigo-600 text-white flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-bold">Chi tiết bài làm</h2>
                  <p className="text-indigo-100 text-sm">{selectedSubmission.studentName} - Lớp {selectedSubmission.studentClass}</p>
                </div>
                <button onClick={() => setSelectedSubmission(null)} className="p-2 hover:bg-white/10 rounded-full"><XCircle className="w-6 h-6" /></button>
              </div>
              <div className="p-8 overflow-y-auto space-y-6">
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 text-center">
                    <div className="text-2xl font-black">{selectedSubmission.score}%</div>
                    <div className="text-[10px] font-bold text-stone-400 uppercase">Điểm số</div>
                  </div>
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 text-center">
                    <div className="text-2xl font-black">{selectedSubmission.completionTime}s</div>
                    <div className="text-[10px] font-bold text-stone-400 uppercase">Thời gian</div>
                  </div>
                  <div className="p-4 bg-stone-50 rounded-2xl border border-stone-100 text-center">
                    <div className="text-2xl font-black">{selectedSubmission.attemptCount}</div>
                    <div className="text-[10px] font-bold text-stone-400 uppercase">Lần thử</div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="font-bold text-lg">Câu trả lời chi tiết</h3>
                  {selectedSubmission.answers.map((ans, idx) => {
                    const assignment = assignments.find(a => a.id === selectedSubmission.assignmentId);
                    const question = assignment?.questions[ans.questionIndex];
                    return (
                      <div key={idx} className={`p-4 rounded-2xl border ${ans.isCorrect ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
                        <div className="font-bold text-sm mb-2">Câu {idx + 1}: {question?.text || '...'}</div>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-stone-400 uppercase font-bold">Học sinh:</span>
                            <div className={`font-bold mt-1 ${ans.isCorrect ? 'text-emerald-700' : 'text-red-700'}`}>{ans.studentAnswer || '(Trống)'}</div>
                          </div>
                          <div>
                            <span className="text-stone-400 uppercase font-bold">Đáp án đúng:</span>
                            <div className="font-bold mt-1 text-emerald-700">{question?.answer}</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );

  const StreakPopup = () => (
    <AnimatePresence>
      {showStreakPopup && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[70] flex items-center justify-center p-6">
          <motion.div
            initial={{ opacity: 0, scale: 0.5, y: 50 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, y: 50 }}
            className="bg-gradient-to-br from-orange-500 to-red-600 p-10 rounded-[3rem] shadow-2xl text-white text-center max-w-sm relative border-4 border-white/20"
          >
            <button onClick={() => setShowStreakPopup(false)} className="absolute top-6 right-6 text-white/60 hover:text-white transition-colors"><XCircle className="w-8 h-8" /></button>
            <div className="w-24 h-24 bg-white/20 rounded-[2rem] flex items-center justify-center text-5xl mx-auto mb-8 animate-bounce shadow-xl backdrop-blur-sm">
              🔥
            </div>
            <div className="space-y-2 mb-8">
              <div className="text-sm font-black opacity-80 uppercase tracking-[0.2em]">Streak mới!</div>
              <div className="text-6xl font-black tracking-tighter">{streakCount} Ngày</div>
              <p className="text-orange-100 font-bold">Bạn đang bùng cháy! Hãy tiếp tục duy trì phong độ này nhé.</p>
            </div>
            <button 
              onClick={() => setShowStreakPopup(false)}
              className="w-full py-5 bg-white text-orange-600 rounded-2xl font-black text-lg shadow-xl hover:bg-orange-50 transition-all active:scale-95"
            >
              TIẾP TỤC HỌC TẬP
            </button>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );

  const renderStudentView = () => {
    const filteredAssignments = assignments.filter(a => {
      const matchCat = categoryFilter === 'Tất cả' || a.category === categoryFilter;
      const matchDiff = difficultyFilter === 'Tất cả' || a.difficulty === difficultyFilter;
      return matchCat && matchDiff;
    });

    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <header className="bg-white border-b border-slate-200 sticky top-0 z-50 shadow-sm">
          <div className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4 px-4 md:px-8 py-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-600 rounded-xl flex items-center justify-center shadow-lg shadow-brand-500/20">
                <GraduationCap className="w-6 h-6 text-white" />
              </div>
              <span className="font-black text-2xl tracking-tighter text-brand-900">EduStudent</span>
            </div>
            <div className="flex items-center gap-4">
              {profile && (
                <motion.div 
                  whileHover={{ scale: 1.05 }}
                  onClick={() => setShowRankLeaderboard(true)}
                  className="flex items-center gap-3 px-4 py-2 bg-white border border-slate-200 rounded-2xl cursor-pointer hover:border-brand-300 transition-all shadow-sm"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-xs shadow-inner ${
                    profile.rank === 'Vàng' ? 'bg-amber-500' : profile.rank === 'Bạc' ? 'bg-slate-400' : 'bg-orange-600'
                  }`}>
                    {profile.rank[0]}
                  </div>
                  <div className="text-xs">
                    <div className="font-black text-brand-950">{profile.points} pts</div>
                    <div className="text-orange-600 font-bold flex items-center gap-1">
                      <Flame className="w-3 h-3 fill-current" /> {profile.streak}
                    </div>
                  </div>
                </motion.div>
              )}
              <div className="flex items-center gap-4 md:gap-6">
                <div className="text-right">
                  <div className="font-black text-brand-950 text-sm md:text-base">{user?.displayName}</div>
                  <div className="text-[10px] md:text-xs text-brand-600 font-bold">Lớp {studentClass || '...'}</div>
                </div>
                <button onClick={() => { signOut(auth).catch(err => console.error('Sign Out Error:', err)); setRole('home'); localStorage.removeItem('app_role'); }} className="text-slate-400 hover:text-red-500 transition-colors">
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            </div>
          </div>
        </header>

        <main className="max-w-6xl mx-auto p-4 md:p-8">
          {!isTakingQuiz && !quizResult ? (
            <div className="space-y-12">
              <div className="flex flex-wrap gap-4 justify-center md:justify-start">
                <a href="#mini-games" className="px-6 py-3 bg-white rounded-2xl font-black text-brand-600 shadow-sm border border-brand-100 hover:bg-brand-50 transition-all">🎮 Mini Games</a>
                <a href="#assignments" className="px-6 py-3 bg-white rounded-2xl font-black text-brand-600 shadow-sm border border-brand-100 hover:bg-brand-50 transition-all">📝 Bài tập</a>
                <a href="#leaderboard" className="px-6 py-3 bg-white rounded-2xl font-black text-brand-600 shadow-sm border border-brand-100 hover:bg-brand-50 transition-all">🏆 Bảng xếp hạng</a>
              </div>

              <div className="bg-white p-6 md:p-8 rounded-3xl border border-slate-200 shadow-sm flex flex-col gap-6">
                <div className="w-full">
                  <label className="block text-xs font-black text-slate-400 uppercase mb-2 tracking-widest">Lớp của bạn</label>
                  <input 
                    type="text" 
                    value={studentClass}
                    onChange={e => setStudentClass(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-brand-500 bg-slate-50/50 font-bold"
                    placeholder="VD: 12A1..."
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                  <div>
                    <label className="block text-xs font-black text-brand-900 uppercase mb-2 tracking-widest">Thể loại</label>
                    <select 
                      value={categoryFilter}
                      onChange={e => setCategoryFilter(e.target.value)}
                      className="w-full px-5 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-brand-500 bg-slate-50/50 font-bold text-brand-950"
                    >
                      <option>Tất cả</option>
                      <option>Thơ</option>
                      <option>Văn xuôi</option>
                      <option>Kịch</option>
                      <option>Lý luận văn học</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-black text-brand-900 uppercase mb-2 tracking-widest">Độ khó</label>
                    <select 
                      value={difficultyFilter}
                      onChange={e => setDifficultyFilter(e.target.value)}
                      className="w-full px-5 py-4 rounded-2xl border border-slate-200 outline-none focus:ring-2 focus:ring-brand-500 bg-slate-50/50 font-bold text-brand-950"
                    >
                      <option>Tất cả</option>
                      <option>Dễ</option>
                      <option>Trung bình</option>
                      <option>Khó</option>
                    </select>
                  </div>
                </div>
              </div>

              <div id="mini-games" className="space-y-6 p-6 md:p-8 bg-brand-50/50 rounded-[2.5rem] border-2 border-brand-200 shadow-inner">
                <h2 className="text-2xl font-black text-brand-950 flex items-center gap-3">
                  <Flame className="w-6 h-6 text-brand-600" /> Trò chơi & Thử thách
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <motion.div 
                    whileHover={{ y: -5 }}
                    onClick={handleStartSpeedRun}
                    className="bg-gradient-to-br from-indigo-50 to-violet-100 p-8 rounded-[2rem] shadow-xl shadow-indigo-500/10 cursor-pointer flex flex-col justify-between border-2 border-indigo-200 relative overflow-hidden group"
                  >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-indigo-500/10 transition-all" />
                    <div className="relative z-10">
                      <div className="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-500/30">
                        <Clock className="w-8 h-8 text-white" />
                      </div>
                      <h3 className="text-2xl font-black mb-2 tracking-tight text-brand-950">Speed Run Văn học</h3>
                      <p className="text-brand-900 text-sm font-medium">Thử thách phản xạ nhanh với các câu hỏi kiến thức văn học.</p>
                    </div>
                    <div className="mt-8 flex items-center gap-2 font-black text-sm text-brand-950 relative z-10">
                      Chơi ngay <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </motion.div>

                  <motion.div 
                    whileHover={{ y: -5 }}
                    onClick={() => setShowRankLeaderboard(true)}
                    className="bg-gradient-to-br from-amber-50 to-orange-100 p-8 rounded-[2rem] shadow-xl shadow-orange-500/10 cursor-pointer flex flex-col justify-between border-2 border-orange-200 relative overflow-hidden group"
                  >
                    <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full -mr-16 -mt-16 blur-2xl group-hover:bg-orange-500/10 transition-all" />
                    <div className="relative z-10">
                      <div className="w-14 h-14 bg-orange-600 rounded-2xl flex items-center justify-center mb-6 shadow-lg shadow-orange-500/30">
                        <Trophy className="w-8 h-8 text-white" />
                      </div>
                      <h3 className="text-2xl font-black mb-2 tracking-tight text-brand-950">Leo rank Văn học</h3>
                      <p className="text-brand-900 text-sm font-medium">Làm bài tích điểm để thăng hạng Đồng → Bạc → Vàng.</p>
                    </div>
                    <div className="mt-8 flex items-center gap-2 font-black text-sm text-brand-950 relative z-10">
                      Xem bảng xếp hạng <ChevronRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </motion.div>
                </div>
              </div>

              <div id="assignments" className="space-y-6">
                <h2 className="text-2xl font-black text-brand-900 flex items-center gap-3">
                  <FileText className="w-6 h-6 text-brand-600" /> Bài tập ôn luyện
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredAssignments.map(assignment => (
                    <motion.div 
                      key={assignment.id} 
                      whileHover={{ y: -5 }}
                      className="bg-white p-6 md:p-8 rounded-[2rem] border border-slate-200 shadow-sm flex flex-col hover:shadow-xl hover:border-brand-200 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-6">
                        <div className="flex gap-2">
                          <span className="px-3 py-1 bg-brand-50 text-brand-600 text-[10px] font-black rounded-lg uppercase tracking-widest">{assignment.category}</span>
                          <span className={`px-3 py-1 text-[10px] font-black rounded-lg uppercase tracking-widest ${
                            assignment.difficulty === 'Dễ' ? 'bg-emerald-50 text-emerald-600' : 
                            assignment.difficulty === 'Trung bình' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-red-600'
                          }`}>{assignment.difficulty}</span>
                        </div>
                        <button onClick={() => setLeaderboardAssignmentId(assignment.id)} className="text-slate-300 hover:text-amber-500 transition-colors">
                          <Trophy className="w-5 h-5" />
                        </button>
                      </div>
                      <h3 className="text-xl font-black mb-4 text-brand-950 group-hover:text-brand-600 transition-colors">{assignment.title}</h3>
                      <p className="text-slate-500 text-sm mb-8 line-clamp-2">{assignment.description || 'Không có mô tả cho bài tập này.'}</p>
                      <button 
                        onClick={() => handleStartQuiz(assignment)} 
                        className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-brand-600 transition-all shadow-lg shadow-slate-900/10 active:scale-95"
                      >
                        Bắt đầu làm bài
                      </button>
                    </motion.div>
                  ))}
                </div>
              </div>

              <div id="leaderboard" className="space-y-6">
                <h2 className="text-2xl font-black text-brand-900 flex items-center gap-3">
                  <Trophy className="w-6 h-6 text-amber-500" /> Bảng xếp hạng tổng quát
                </h2>
                <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-8 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                    <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Top học sinh</span>
                    <button onClick={() => setShowRankLeaderboard(true)} className="text-brand-600 font-black text-xs uppercase tracking-widest hover:underline">Xem chi tiết</button>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {allProfiles.slice(0, 5).map((p, idx) => (
                      <div key={p.userId} className="flex items-center gap-4 p-6 hover:bg-slate-50 transition-colors">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${idx === 0 ? 'bg-amber-100 text-amber-600' : idx === 1 ? 'bg-slate-200 text-slate-600' : idx === 2 ? 'bg-orange-100 text-orange-600' : 'bg-white text-slate-400'}`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-bold text-slate-900">{p.displayName}</div>
                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Lớp {p.studentClass || '...'}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-brand-600">{p.points}</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Điểm</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : isTakingQuiz && activeAssignment ? (
            <div className="grid lg:grid-cols-3 gap-8 relative">
              <button 
                onClick={() => { setIsTakingQuiz(false); setActiveAssignment(null); }}
                className="absolute -top-12 left-0 flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-all"
              >
                <ArrowLeft className="w-5 h-5" /> Thoát làm bài
              </button>
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                  <h2 className="text-2xl font-bold mb-6">{activeAssignment.title}</h2>
                  <div className="prose prose-stone max-w-none text-stone-700 leading-relaxed whitespace-pre-wrap">
                    {activeAssignment.content}
                  </div>
                </div>

                <div className="space-y-6">
                  {activeAssignment.questions.map((q, qIdx) => (
                    <div key={qIdx} className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
                      <h3 className="font-bold text-lg mb-6 flex gap-3">
                        <span className="w-8 h-8 bg-stone-100 rounded-lg flex items-center justify-center flex-shrink-0 text-sm">{qIdx + 1}</span>
                        {q.text}
                      </h3>
                    <div className="grid gap-3">
                      {q.type === 'multiple-choice' ? (
                        q.options.map((opt, oIdx) => {
                          const label = String.fromCharCode(65 + oIdx);
                          return (
                            <button 
                              key={oIdx}
                              onClick={() => {
                                const newAns = [...currentAnswers];
                                newAns[qIdx] = label;
                                setCurrentAnswers(newAns);
                              }}
                              className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-4 ${
                                currentAnswers[qIdx] === label 
                                  ? 'border-emerald-500 bg-emerald-50 text-emerald-700' 
                                  : 'border-stone-100 hover:border-stone-200 text-stone-600'
                              }`}
                            >
                              <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${
                                currentAnswers[qIdx] === label ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-400'
                              }`}>
                                {label}
                              </span>
                              {opt}
                            </button>
                          );
                        })
                      ) : (
                        <input 
                          type="text"
                          value={currentAnswers[qIdx]}
                          onChange={e => {
                            const newAns = [...currentAnswers];
                            newAns[qIdx] = e.target.value;
                            setCurrentAnswers(newAns);
                          }}
                          className="w-full p-4 rounded-2xl border border-stone-100 focus:border-emerald-500 outline-none bg-stone-50 font-medium"
                          placeholder="Nhập câu trả lời của bạn..."
                        />
                      )}
                    </div>
                    </div>
                  ))}
                </div>

                <button onClick={handleSubmitQuiz} className="w-full py-5 bg-emerald-600 text-white rounded-3xl font-bold text-lg hover:bg-emerald-700 transition-all">
                  Nộp bài hoàn tất
                </button>
              </div>

              <div className="space-y-6">
                <div className="bg-white p-6 rounded-3xl border border-stone-200 shadow-sm sticky top-24">
                  <h3 className="font-bold mb-4">Tiến độ làm bài</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {activeAssignment.questions.map((_, idx) => (
                      <div key={idx} className={`h-10 rounded-xl flex items-center justify-center font-bold text-xs ${currentAnswers[idx] ? 'bg-emerald-500 text-white' : 'bg-stone-100 text-stone-400'}`}>
                        {idx + 1}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : quizResult && activeAssignment ? (
            <div className="max-w-3xl mx-auto space-y-8 relative">
              <button 
                onClick={() => { setQuizResult(null); setIsTakingQuiz(false); setActiveAssignment(null); }}
                className="absolute -top-12 left-0 flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold transition-all"
              >
                <ArrowLeft className="w-5 h-5" /> Quay lại danh sách
              </button>
              <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="bg-white p-10 rounded-[40px] border border-stone-200 shadow-xl text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
                <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-12 h-12 text-emerald-600" />
                </div>
                <h2 className="text-3xl font-bold mb-2">Hoàn thành bài thi!</h2>
                <div className="flex justify-center gap-12 my-8">
                  <div>
                    <div className="text-5xl font-black">{quizResult.score}%</div>
                    <div className="text-xs font-bold text-stone-400 uppercase mt-2">Điểm số</div>
                  </div>
                  <div>
                    <div className="text-5xl font-black">{quizResult.completionTime}s</div>
                    <div className="text-xs font-bold text-stone-400 uppercase mt-2">Thời gian</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <button onClick={() => { setQuizResult(null); setIsTakingQuiz(false); setActiveAssignment(null); }} className="py-4 bg-stone-100 text-stone-900 rounded-2xl font-bold">Về danh sách</button>
                  <button onClick={() => handleStartQuiz(activeAssignment)} className="py-4 bg-emerald-600 text-white rounded-2xl font-bold">Làm lại</button>
                </div>
              </motion.div>

              <div className="space-y-4">
                <h3 className="font-bold text-xl px-2">Chi tiết đáp án</h3>
                {activeAssignment.questions.map((q, idx) => {
                  const result = quizResult.answers[idx];
                  return (
                    <div key={idx} className="bg-white p-6 rounded-3xl border border-stone-200 flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${result.isCorrect ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
                        {result.isCorrect ? <CheckCircle2 className="w-6 h-6" /> : <XCircle className="w-6 h-6" />}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-stone-900 mb-1">Câu {idx + 1}: {q.text}</div>
                        <div className="text-sm text-stone-500">Bạn chọn: <span className="font-bold">{result.studentAnswer}</span> | Đáp án đúng: <span className="font-bold text-emerald-600">{q.answer}</span></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </main>

        <AnimatePresence>
          {showRankLeaderboard && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
              onClick={() => setShowRankLeaderboard(false)}
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.9 }} 
                className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 md:p-8 bg-brand-50 border-b border-brand-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Trophy className="w-8 h-8 md:w-10 md:h-10 text-brand-600" />
                    <div>
                      <h2 className="text-xl md:text-2xl font-black text-brand-950">BXH Leo Rank</h2>
                      <p className="text-brand-600 text-xs md:text-sm font-medium">Những học sinh chăm chỉ nhất</p>
                    </div>
                  </div>
                  <button onClick={() => setShowRankLeaderboard(false)} className="p-2 hover:bg-brand-100 text-brand-400 rounded-full transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="p-6 md:p-8 max-h-[60vh] overflow-y-auto bg-white">
                  <div className="space-y-3">
                    {allProfiles.map((p, idx) => (
                      <div key={p.userId} className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${p.userId === user?.uid ? 'bg-brand-50 border-brand-200 shadow-sm' : 'bg-white border-brand-100 hover:border-brand-200'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${idx === 0 ? 'bg-amber-100 text-amber-600' : idx === 1 ? 'bg-slate-100 text-slate-600' : idx === 2 ? 'bg-orange-100 text-orange-600' : 'bg-brand-50 text-brand-400'}`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-black text-brand-950">{p.displayName}</div>
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-black text-white ${
                              p.rank === 'Vàng' ? 'bg-amber-500' : p.rank === 'Bạc' ? 'bg-slate-400' : 'bg-orange-600'
                            }`}>{p.rank}</span>
                            <span className="text-xs text-brand-500 font-medium">{p.streak}🔥 streak</span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-brand-950 text-lg">{p.points}</div>
                          <div className="text-[10px] text-brand-400 font-black uppercase tracking-wider">Điểm</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Leaderboard Modal */}
        <AnimatePresence>
          {leaderboardAssignmentId && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
              onClick={() => setLeaderboardAssignmentId(null)}
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.9 }} 
                className="bg-white w-full max-w-2xl rounded-[2.5rem] shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 md:p-8 bg-brand-50 border-b border-brand-100 flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <Trophy className="w-8 h-8 md:w-10 md:h-10 text-brand-600" />
                    <div>
                      <h2 className="text-xl md:text-2xl font-black text-brand-950">Bảng Xếp Hạng</h2>
                      <p className="text-brand-600 text-xs md:text-sm font-medium">Top 10 học sinh xuất sắc nhất</p>
                    </div>
                  </div>
                  <button onClick={() => setLeaderboardAssignmentId(null)} className="p-2 hover:bg-brand-100 text-brand-400 rounded-full transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="p-6 md:p-8 bg-white">
                  <div className="space-y-3">
                    {getRankings(leaderboardAssignmentId).map((rank, idx) => (
                      <div key={rank.id} className="flex items-center gap-4 p-4 bg-brand-50/50 rounded-2xl border border-brand-100 hover:border-brand-200 transition-all">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black ${idx === 0 ? 'bg-amber-100 text-amber-600' : idx === 1 ? 'bg-slate-100 text-slate-600' : idx === 2 ? 'bg-orange-100 text-orange-600' : 'bg-brand-50 text-brand-400'}`}>
                          {idx + 1}
                        </div>
                        <div className="flex-1">
                          <div className="font-black text-brand-950">{rank.studentName}</div>
                          <div className="text-xs text-brand-500 font-medium">Lớp {rank.studentClass}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-black text-brand-950 text-lg">{rank.score}%</div>
                          <div className="text-[10px] text-brand-400 font-black uppercase tracking-wider">{rank.completionTime}s</div>
                        </div>
                      </div>
                    ))}
                    {getRankings(leaderboardAssignmentId).length === 0 && <p className="text-center py-10 text-brand-400 font-medium">Chưa có lượt nộp bài nào.</p>}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Speed Run Modal */}
        <AnimatePresence>
          {isSpeedRunActive && (
            <div 
              className="fixed inset-0 bg-black/60 backdrop-blur-md z-50 flex items-center justify-center p-4 md:p-6"
              onClick={handleEndSpeedRun}
            >
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }} 
                animate={{ scale: 1, opacity: 1 }} 
                className="bg-white w-full max-w-xl rounded-[2.5rem] shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-8 bg-indigo-600 text-white flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center font-black text-xl">
                      {speedRunTime}s
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold">Speed Run</h2>
                      <p className="text-indigo-100 text-sm">Điểm hiện tại: {speedRunScore}</p>
                    </div>
                  </div>
                  <button onClick={handleEndSpeedRun} className="p-2 hover:bg-white/10 rounded-full"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="p-10">
                  {currentSpeedQuestion ? (
                    <form onSubmit={handleSpeedSubmit} className="space-y-8">
                      <div className="text-center">
                        <span className="px-3 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-bold rounded-lg uppercase mb-4 inline-block">
                          {currentSpeedQuestion.category}
                        </span>
                        <h3 className="text-3xl font-black text-stone-900 leading-tight">
                          {currentSpeedQuestion.text}
                        </h3>
                      </div>
                      <input 
                        autoFocus
                        type="text" 
                        value={speedInput}
                        onChange={e => setSpeedInput(e.target.value)}
                        className="w-full px-6 py-5 bg-stone-50 rounded-2xl border-2 border-transparent focus:border-indigo-500 outline-none text-center text-2xl font-bold"
                        placeholder="Nhập câu trả lời..."
                      />
                      <button type="submit" className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg shadow-lg shadow-indigo-200">
                        Gửi (Enter)
                      </button>
                    </form>
                  ) : (
                    <div className="text-center py-10">Đang tải câu hỏi...</div>
                  )}
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {showAIChat && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
              onClick={() => setShowAIChat(false)}
            >
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: 20 }} 
                className="bg-white w-full max-w-2xl h-[85vh] md:h-[600px] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 bg-emerald-600 text-white flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <BrainCircuit className="w-6 h-6" />
                    <h2 className="font-bold text-white">Trợ lý Học tập AI</h2>
                  </div>
                  <button onClick={() => setShowAIChat(false)} className="text-white/60 hover:text-white transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                  {chatMessages.length === 0 && (
                    <div className="text-center text-stone-400 py-10">
                      Chào bạn! Mình có thể giúp gì cho bạn trong việc ôn tập hôm nay?
                    </div>
                  )}
                  {chatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-blue-50 text-blue-700 rounded-tl-none border border-blue-100 shadow-sm'}`}>
                        <div className="markdown-body">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isAiLoading && <div className="flex justify-start"><div className="bg-stone-100 p-4 rounded-2xl animate-pulse">AI đang suy nghĩ...</div></div>}
                </div>
                <div className="p-6 border-t border-stone-100">
                  <div className="relative">
                    <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleAIChat()} placeholder="Hỏi AI về kiến thức văn học..." className="w-full pl-6 pr-16 py-4 bg-stone-50 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    <button onClick={handleAIChat} className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-emerald-600 text-white rounded-xl"><Send className="w-5 h-5" /></button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showSearchAgent && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
              onClick={() => setShowSearchAgent(false)}
            >
              <motion.div 
                initial={{ opacity: 0, y: 20 }} 
                animate={{ opacity: 1, y: 0 }} 
                exit={{ opacity: 0, y: 20 }} 
                className="bg-white w-full max-w-3xl h-[85vh] md:h-[600px] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 bg-brand-600 text-white flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <Globe className="w-6 h-6 text-white" />
                    <h2 className="font-bold text-white">Trợ lý Tin tức & Sự kiện</h2>
                  </div>
                  <button onClick={() => setShowSearchAgent(false)} className="text-stone-400 hover:text-white transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6">
                  {searchChatMessages.map((msg, idx) => (
                    <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed ${msg.role === 'user' ? 'bg-emerald-600 text-white rounded-tr-none' : 'bg-stone-100 text-stone-800 rounded-tl-none shadow-sm'}`}>
                        <div className="markdown-body">
                          <Markdown>{msg.text}</Markdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isSearchLoading && <div className="flex justify-start"><div className="bg-stone-100 p-4 rounded-2xl animate-pulse">Đang tìm kiếm thông tin...</div></div>}
                </div>
                <div className="p-6 border-t border-stone-100">
                  <div className="relative">
                    <input type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)} onKeyPress={e => e.key === 'Enter' && handleSearchAgent()} placeholder="Hỏi về tin tức, sự kiện hoặc kiểm chứng thông tin..." className="w-full pl-6 pr-16 py-4 bg-stone-50 rounded-2xl outline-none focus:ring-2 focus:ring-emerald-500" />
                    <button onClick={handleSearchAgent} className="absolute right-3 top-1/2 -translate-y-1/2 p-3 bg-stone-900 text-white rounded-xl"><Send className="w-5 h-5" /></button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {selectedSubmission && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 md:p-6"
              onClick={() => setSelectedSubmission(null)}
            >
              <motion.div 
                initial={{ opacity: 0, scale: 0.95 }} 
                animate={{ opacity: 1, scale: 1 }} 
                exit={{ opacity: 0, scale: 0.95 }} 
                className="bg-white w-full max-w-3xl max-h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
              >
                <div className="p-6 bg-brand-600 text-white flex justify-between items-center">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center font-black text-xl">
                      {selectedSubmission.studentName[0]}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-white">{selectedSubmission.studentName}</h2>
                      <p className="text-brand-100 text-xs">Lớp {selectedSubmission.studentClass} • {selectedSubmission.assignmentTitle}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedSubmission(null)} className="text-white/60 hover:text-white transition-colors"><XCircle className="w-6 h-6" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                    <div className="bg-brand-50 p-6 rounded-3xl text-center">
                      <div className="text-3xl font-black text-brand-600">{selectedSubmission.score}%</div>
                      <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest mt-1">Điểm số</div>
                    </div>
                    <div className="bg-brand-50 p-6 rounded-3xl text-center">
                      <div className="text-3xl font-black text-brand-600">{selectedSubmission.completionTime}s</div>
                      <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest mt-1">Thời gian</div>
                    </div>
                    <div className="bg-brand-50 p-6 rounded-3xl text-center">
                      <div className="text-3xl font-black text-brand-600">{selectedSubmission.answers.filter(a => a.isCorrect).length}/{selectedSubmission.answers.length}</div>
                      <div className="text-[10px] font-black text-brand-400 uppercase tracking-widest mt-1">Số câu đúng</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="font-black text-brand-900 uppercase tracking-widest text-xs ml-1">Chi tiết bài làm</h3>
                    {selectedSubmission.answers.map((ans, idx) => (
                      <div key={idx} className={`p-6 rounded-2xl border-2 ${ans.isCorrect ? 'bg-emerald-50/30 border-emerald-100' : 'bg-red-50/30 border-red-100'}`}>
                        <div className="flex items-start gap-4">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 font-black text-xs ${ans.isCorrect ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}`}>
                            {idx + 1}
                          </div>
                          <div className="flex-1">
                            <div className="font-bold text-brand-900 mb-2">Câu {idx + 1}</div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-brand-400 font-bold block mb-1 uppercase text-[10px]">Học sinh chọn</span>
                                <span className={`font-bold ${ans.isCorrect ? 'text-emerald-600' : 'text-red-600'}`}>{ans.studentAnswer || '(Trống)'}</span>
                              </div>
                              <div>
                                <span className="text-brand-400 font-bold block mb-1 uppercase text-[10px]">Đáp án đúng</span>
                                <span className="font-bold text-emerald-600">{selectedSubmission.answers[idx].isCorrect ? ans.studentAnswer : 'Xem lại đề bài'}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Floating Actions */}
        <div className="fixed bottom-6 right-6 md:bottom-8 md:right-8 flex flex-col gap-4 z-40">
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowSearchAgent(true)} 
            className="w-14 h-14 md:w-16 md:h-16 bg-brand-600 text-white rounded-2xl md:rounded-3xl shadow-2xl shadow-brand-600/20 flex items-center justify-center transition-all border border-white/10"
          >
            <Globe className="w-6 h-6 md:w-7 md:h-7" />
          </motion.button>
          <motion.button 
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowAIChat(!showAIChat)} 
            className="w-14 h-14 md:w-16 md:h-16 bg-brand-600 text-white rounded-2xl md:rounded-3xl shadow-2xl shadow-brand-600/20 flex items-center justify-center transition-all border border-white/10"
          >
            <Bot className="w-6 h-6 md:w-7 md:h-7" />
          </motion.button>
        </div>
      </div>
    );
  };

  const renderSpeedRunAdmin = () => (
    <div className="min-h-screen bg-stone-50 flex">
      <div className="w-64 bg-white border-r border-stone-200 p-6 flex flex-col">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
            <BookOpen className="w-6 h-6 text-white" />
          </div>
          <span className="font-bold text-xl">EduAdmin</span>
        </div>
        <nav className="flex-1 space-y-2">
          <button onClick={() => setRole('admin')} className="w-full flex items-center gap-3 px-4 py-3 text-stone-500 hover:bg-stone-50 rounded-xl font-medium transition-colors">
            <LayoutDashboard className="w-5 h-5" /> Dashboard
          </button>
          <button onClick={() => setRole('speedrun')} className="w-full flex items-center gap-3 px-4 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-medium">
            <Clock className="w-5 h-5" /> Speed Run
          </button>
        </nav>
        <div className="pt-6 border-t border-stone-100 space-y-2">
          <button 
            onClick={() => {
              signOut(auth).then(() => {
                setRole('home');
                setIsAdminLoggedIn(false);
                localStorage.removeItem('app_role');
                localStorage.removeItem('admin_logged_in');
              }).catch(err => {
                console.error('Sign Out Error:', err);
              });
            }}
            className="w-full flex items-center gap-3 px-4 py-3 text-red-500 hover:bg-red-50 rounded-xl font-medium transition-colors"
          >
            <LogOut className="w-5 h-5" /> Đăng xuất
          </button>
        </div>
      </div>

      <div className="flex-1 p-8 overflow-y-auto">
        <div className="max-w-4xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-bold text-stone-900">Quản lý Speed Run</h1>
            <p className="text-stone-500">Thêm các câu hỏi ngắn để học sinh luyện phản xạ</p>
          </div>

            <div className="bg-white p-8 rounded-3xl border border-stone-200 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-bold">Thêm câu hỏi mới</h2>
                <label className="cursor-pointer flex items-center gap-2 text-xs font-bold text-indigo-600 hover:text-indigo-700">
                  <Upload className="w-4 h-4" /> Tải file câu hỏi (.txt)
                  <input type="file" accept=".txt" onChange={e => handleFileUpload(e, 'speedrun')} className="hidden" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-4">
              <input 
                type="text" 
                placeholder="Câu hỏi (VD: Tác giả Vợ chồng A Phủ?)" 
                className="px-4 py-3 rounded-xl border border-stone-200 outline-none" 
                value={srForm.text}
                onChange={e => setSrForm({...srForm, text: e.target.value})}
              />
              <input 
                type="text" 
                placeholder="Đáp án (VD: Tô Hoài)" 
                className="px-4 py-3 rounded-xl border border-stone-200 outline-none" 
                value={srForm.answer}
                onChange={e => setSrForm({...srForm, answer: e.target.value})}
              />
            </div>
            <div className="flex gap-4 mb-6">
              <select 
                className="flex-1 px-4 py-3 rounded-xl border border-stone-200 outline-none"
                value={srForm.category}
                onChange={e => setSrForm({...srForm, category: e.target.value})}
              >
                <option>Tác giả</option>
                <option>Năm sáng tác</option>
                <option>Phong cách</option>
              </select>
              <button 
                onClick={async () => {
                  if (!srForm.text || !srForm.answer) return;
                  try {
                    await addDoc(collection(db, 'speedrunQuestions'), srForm);
                    setSrForm({ text: '', answer: '', category: 'Tác giả' });
                    alert('Đã thêm câu hỏi!');
                  } catch (error) {
                    handleFirestoreError(error, OperationType.CREATE, 'speedrunQuestions');
                  }
                }}
                className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold"
              >
                Thêm
              </button>
            </div>
          </div>

          <div className="bg-white rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-stone-50 text-stone-500 text-xs uppercase font-bold">
                <tr>
                  <th className="px-6 py-4">Câu hỏi</th>
                  <th className="px-6 py-4">Đáp án</th>
                  <th className="px-6 py-4">Thể loại</th>
                  <th className="px-6 py-4">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {speedrunQuestions.map(q => (
                  <tr key={q.id}>
                    <td className="px-6 py-4 font-medium">{q.text}</td>
                    <td className="px-6 py-4">{q.answer}</td>
                    <td className="px-6 py-4"><span className="px-2 py-1 bg-stone-100 rounded-lg text-[10px] font-bold uppercase">{q.category}</span></td>
                    <td className="px-6 py-4">
                      <button 
                        onClick={async () => {
                          try {
                            await deleteDoc(doc(db, 'speedrunQuestions', q.id));
                          } catch (error) {
                            handleFirestoreError(error, OperationType.DELETE, `speedrunQuestions/${q.id}`);
                          }
                        }} 
                        className="text-red-500 hover:text-red-700"
                      >
                        Xoá
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  if (role === 'home') return renderHome();
  if (role === 'speedrun') return renderSpeedRunAdmin();
  if (role === 'admin') {
    return isAdminLoggedIn ? renderAdminDashboard() : renderAdminLogin();
  }
  return renderStudentView();
}
