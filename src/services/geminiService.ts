import { GoogleGenAI, ThinkingLevel } from "@google/genai";

// Support multiple API keys separated by commas for rotation
const API_KEYS_STR = process.env.GEMINI_API_KEY || 
                     ((import.meta as any).env?.VITE_GEMINI_API_KEY as string) || 
                     ((import.meta as any).env?.GEMINI_API_KEY as string) || '';

const API_KEYS = API_KEYS_STR.split(',').map(key => key.trim()).filter(key => key.length > 0);
let currentKeyIndex = 0;

function getAiInstance() {
  if (API_KEYS.length === 0) return null;
  const key = API_KEYS[currentKeyIndex];
  return new GoogleGenAI({ apiKey: key });
}

async function rotateKey() {
  if (API_KEYS.length > 1) {
    currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
    console.log(`Đã chuyển sang API Key dự phòng (Key #${currentKeyIndex + 1})`);
    return true;
  }
  return false;
}

async function callWithRetry(fn: (ai: any, isOpenRouter: boolean, apiKey: string) => Promise<any>): Promise<any> {
  let attempts = 0;
  const maxAttempts = Math.max(1, API_KEYS.length * 2);
  const errors: string[] = [];

  while (attempts < maxAttempts) {
    const key = API_KEYS[currentKeyIndex];
    if (!key) {
      throw new Error("Lỗi: API Key chưa được cấu hình. Vui lòng thiết lập biến môi trường GEMINI_API_KEY.");
    }

    const isOpenRouter = key.startsWith('sk-or-v1-');
    const ai = !isOpenRouter ? new GoogleGenAI({ apiKey: key }) : null;

    try {
      return await fn(ai, isOpenRouter, key);
    } catch (error: any) {
      // Cải thiện việc bắt lỗi: Chuyển sang string để kiểm tra mã lỗi
      const errorMessage = error?.message || String(error);
      const errorStatus = error?.status || (error?.response?.status);
      const errorStr = (errorMessage + " " + JSON.stringify(error)).toLowerCase();
      
      const isQuotaError = errorStatus === 429 || errorStr.includes('429') || errorStr.includes('quota') || errorStr.includes('exhausted');
      const isInvalidKeyError = errorStatus === 401 || errorStatus === 400 || errorStr.includes('400') || errorStr.includes('401') || errorStr.includes('invalid') || errorStr.includes('not valid');

      if (isQuotaError || isInvalidKeyError) {
        const errorType = isQuotaError ? "hết hạn mức (429)" : "không hợp lệ (400/401)";
        console.warn(`API Key #${currentKeyIndex + 1} ${errorType}. Đang thử xoay vòng...`);
        
        const errorKey = `Key #${currentKeyIndex + 1}: ${errorType}`;
        if (!errors.includes(errorKey)) {
          errors.push(errorKey);
        }
        
        const rotated = await rotateKey();
        if (rotated) {
          attempts++;
          const delay = isQuotaError ? 2000 : 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
      }
      
      console.error('AI Service Error:', error);
      throw error;
    }
  }
  
  const errorSummary = errors.length > 0 ? `\nChi tiết:\n${errors.join('\n')}` : "";
  throw new Error(`Tất cả API Keys đều gặp lỗi hoặc hết hạn mức.${errorSummary}\n\nLƯU Ý: Nếu bạn dùng OpenRouter, hãy đảm bảo Key có định dạng sk-or-v1-... và tài khoản có đủ số dư.`);
}

// Helper for OpenRouter fetch
async function fetchOpenRouter(prompt: string, apiKey: string, systemInstruction?: string, responseMimeType?: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-Title": "Học Văn Gen Z",
    },
    body: JSON.stringify({
      "model": "google/gemini-2.0-flash-001", // Hoặc mô hình khác bạn muốn dùng qua OpenRouter
      "messages": [
        ...(systemInstruction ? [{ "role": "system", "content": systemInstruction }] : []),
        { "role": "user", "content": prompt }
      ],
      "response_format": responseMimeType === 'application/json' ? { "type": "json_object" } : undefined
    })
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw errorData;
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

export async function getAIHelp(
  question: string,
  studentAnswer: string,
  correctAnswer: string,
  assignmentContent: string,
  knowledgeBase: string,
  chatHistory: { role: string, text: string }[]
) {
  return callWithRetry(async (ai, isOpenRouter, apiKey) => {
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

    if (isOpenRouter) {
      const historyText = chatHistory.map(m => `${m.role === 'user' ? 'Học sinh' : 'AI'}: ${m.text}`).join('\n');
      const prompt = `${historyText}\n\nHọc sinh: Hãy giúp mình hiểu tại sao mình sai hoặc gợi ý cách làm câu này.`;
      return await fetchOpenRouter(prompt, apiKey, systemInstruction);
    }

    const model = "gemini-3-flash-preview";
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
  });
}

export async function generateAIContent(prompt: string, responseMimeType: string = 'text/plain') {
  return callWithRetry(async (ai, isOpenRouter, apiKey) => {
    if (isOpenRouter) {
      return await fetchOpenRouter(prompt, apiKey, undefined, responseMimeType);
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
  });
}

export async function searchAgent(query: string, chatHistory: { role: string, text: string }[]) {
  return callWithRetry(async (ai, isOpenRouter, apiKey) => {
    const systemInstruction = `
      Bạn là một trợ lý thông tin thông minh. 
      Bạn có khả năng tìm kiếm thông tin thời gian thực qua Google Search để thảo luận về các sự kiện hiện tại, trích dẫn tin tức mới nhất hoặc kiểm chứng thông tin.
      Hãy trả lời bằng tiếng Việt, trích dẫn nguồn rõ ràng nếu có.
    `;

    if (isOpenRouter) {
      const historyText = chatHistory.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.text}`).join('\n');
      const prompt = `${historyText}\n\nUser: ${query}`;
      return await fetchOpenRouter(prompt, apiKey, systemInstruction);
    }

    const model = "gemini-3-flash-preview";
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
  });
}

export async function checkAnswerWithAI(question: string, studentAnswer: string, correctAnswer: string) {
  try {
    return await callWithRetry(async (ai, isOpenRouter, apiKey) => {
      const prompt = `
        Bạn là một giám khảo chấm thi môn Ngữ Văn cực kỳ công tâm và linh hoạt.
        Nhiệm vụ: So sánh câu trả lời của học sinh với đáp án đúng để xác định xem học sinh có hiểu bài và trả lời đúng ý hay không.
        
        Câu hỏi: "${question}"
        Đáp án chuẩn: "${correctAnswer}"
        Câu trả lời của học sinh: "${studentAnswer}"
        
        QUY TẮC CHẤM ĐIỂM:
        1. Chấp nhận các biến thể về từ đồng nghĩa (ví dụ: "vui vẻ" tương đương với "hạnh phúc" trong ngữ cảnh phù hợp).
        2. Chấp nhận các cách diễn đạt khác nhau nhưng cùng một ý nghĩa cốt lõi.
        3. Bỏ qua các lỗi chính tả nhỏ, lỗi ngữ pháp hoặc cách trình bày (ví dụ: "Câu 1 là:", "Theo em...", viết hoa/viết thường).
        4. Nếu câu trả lời của học sinh chứa ý chính của đáp án chuẩn, hãy coi là ĐÚNG.
        5. Chỉ coi là SAI nếu học sinh trả lời lạc đề, sai kiến thức cơ bản hoặc không có ý nào trùng khớp với đáp án chuẩn.
        
        KẾT QUẢ TRẢ VỀ:
        - Trả về "CORRECT" nếu đúng hoặc gần đúng ý.
        - Trả về "INCORRECT" nếu sai hoàn toàn.
        - CHỈ TRẢ VỀ DUY NHẤT MỘT TỪ: "CORRECT" HOẶC "INCORRECT".
      `;

      if (isOpenRouter) {
        const result = await fetchOpenRouter(prompt, apiKey);
        const upperResult = result.trim().toUpperCase();
        return upperResult.includes('CORRECT') && !upperResult.includes('INCORRECT');
      }
      
      const model = "gemini-3-flash-preview";
      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { 
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }
        },
      });
      const result = response.text.trim().toUpperCase();
      return result.includes('CORRECT') && !result.includes('INCORRECT');
    });
  } catch (error) {
    console.error('AI Check Error:', error);
    return null;
  }
}
