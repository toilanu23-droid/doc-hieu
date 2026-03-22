import { GoogleGenAI } from "@google/genai";

// Support both process.env (for AI Studio) and import.meta.env (for Vite/Netlify)
const API_KEY = process.env.GEMINI_API_KEY || 
                ((import.meta as any).env?.VITE_GEMINI_API_KEY as string) || 
                ((import.meta as any).env?.GEMINI_API_KEY as string) || '';

const ai = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

export async function getAIHelp(
  question: string,
  studentAnswer: string,
  correctAnswer: string,
  assignmentContent: string,
  knowledgeBase: string,
  chatHistory: { role: string, text: string }[]
) {
  if (!ai) {
    return "Lỗi: API Key chưa được cấu hình. Vui lòng thiết lập biến môi trường VITE_GEMINI_API_KEY hoặc GEMINI_API_KEY trong cài đặt dự án của bạn.";
  }
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    Bạn là một trợ lý học tập cực kỳ "cool" và thông minh cho các bạn học sinh Gen Z. 
    Phong cách của bạn: Năng động, sử dụng ngôn ngữ trẻ trung nhưng vẫn chuyên nghiệp, có thể dùng một vài emoji phù hợp (như ✨, 🚀, 💡).
    Nhiệm vụ: Giải thích lỗi sai, hướng dẫn cách làm bài, phân tích kiến thức dựa trên nội dung bài đọc và file kiến thức bổ sung.
    
    QUY TẮC QUAN TRỌNG:
    1. KHÔNG bao giờ đưa ra đáp án trực tiếp cho học sinh.
    2. Chỉ gợi ý, đặt câu hỏi gợi mở để học sinh tự tìm ra câu trả lời.
    3. Phân tích tại sao câu trả lời của học sinh chưa chính xác dựa trên ngữ cảnh bài đọc.
    4. Sử dụng ngôn ngữ thân thiện, khuyến khích học sinh.
    5. Trình bày câu trả lời rõ ràng, sử dụng định dạng Markdown (in đậm, danh sách) để dễ đọc.
    
    NGỮ CẢNH BÀI ĐỌC:
    ${assignmentContent}
    
    KIẾN THỨC BỔ SUNG TỪ GIÁO VIÊN:
    ${knowledgeBase}
    
    CÂU HỎI ĐANG LÀM: ${question}
    ĐÁP ÁN CỦA HỌC SINH: ${studentAnswer}
    ĐÁP ÁN ĐÚNG (CHỈ DÙNG ĐỂ BẠN BIẾT ĐỂ HƯỚNG DẪN, KHÔNG TIẾT LỘ): ${correctAnswer}
  `;

  const contents = chatHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  const response = await ai.models.generateContent({
    model,
    contents: [
      ...contents,
      { role: 'user', parts: [{ text: "Hãy giúp mình hiểu tại sao mình sai hoặc gợi ý cách làm câu này." }] }
    ],
    config: {
      systemInstruction,
      temperature: 0.7,
      tools: [{ googleSearch: {} }]
    },
  });

  return response.text;
}

export async function generateAIContent(prompt: string, responseMimeType: string = 'text/plain') {
  if (!ai) {
    return "Lỗi: API Key chưa được cấu hình. Vui lòng thiết lập biến môi trường VITE_GEMINI_API_KEY hoặc GEMINI_API_KEY trong cài đặt dự án của bạn.";
  }
  const model = "gemini-3-flash-preview";
  
  const response = await ai.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      temperature: 0.7,
      responseMimeType
    },
  });

  return response.text;
}

export async function searchAgent(query: string, chatHistory: { role: string, text: string }[]) {
  if (!ai) {
    return "Lỗi: API Key chưa được cấu hình. Vui lòng thiết lập biến môi trường VITE_GEMINI_API_KEY hoặc GEMINI_API_KEY trong cài đặt dự án của bạn.";
  }
  const model = "gemini-3-flash-preview";
  
  const systemInstruction = `
    Bạn là một trợ lý thông tin thông minh. 
    Bạn có khả năng tìm kiếm thông tin thời gian thực qua Google Search để thảo luận về các sự kiện hiện tại, trích dẫn tin tức mới nhất hoặc kiểm chứng thông tin.
    Hãy trả lời bằng tiếng Việt, trích dẫn nguồn rõ ràng nếu có.
  `;

  const contents = chatHistory.map(msg => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text }]
  }));

  const response = await ai.models.generateContent({
    model,
    contents: [
      ...contents,
      { role: 'user', parts: [{ text: query }] }
    ],
    config: {
      systemInstruction,
      temperature: 0.7,
      tools: [{ googleSearch: {} }]
    },
  });

  return response.text;
}

export async function checkAnswerWithAI(question: string, studentAnswer: string, correctAnswer: string) {
  if (!ai) return null;
  const model = "gemini-3-flash-preview";
  const prompt = `
    Bạn là một giám khảo chấm thi môn Ngữ Văn.
    Câu hỏi: ${question}
    Đáp án đúng: ${correctAnswer}
    Câu trả lời của học sinh: ${studentAnswer}
    
    Hãy xác định xem câu trả lời của học sinh có đúng ý với đáp án đúng hay không.
    Lưu ý: Học sinh có thể viết thêm các từ như "Câu 1:", "Theo mình là", "Đáp án là"... hãy bỏ qua những phần đó và tập trung vào nội dung chính.
    Nếu đúng hoặc gần đúng ý, hãy trả về "CORRECT".
    Nếu sai, hãy trả về "INCORRECT".
    Chỉ trả về duy nhất một từ "CORRECT" hoặc "INCORRECT".
  `;
  
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { temperature: 0.1 },
    });
    const result = response.text.trim().toUpperCase();
    return result.includes('CORRECT') && !result.includes('INCORRECT');
  } catch (error) {
    console.error('AI Check Error:', error);
    return null;
  }
}
