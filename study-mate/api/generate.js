const ALLOWED_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.8-flash",
  "gemini-4-hydrogen",
];
const ALLOWED_TYPES = ["multiple_choice", "short_answer", "ox", "mixed"];
const ALLOWED_COUNTS = [5, 10, 15];
const SAFE_GENERAL_TAGS = ["기초 개념", "개념 이해", "응용", "기억력"];

function mapApiErrorMessage(status, rawMsg = "") {
  if (status === 400) {
    return "요청 형식에 문제가 있습니다. 입력 내용을 확인한 뒤 다시 시도해 주세요.";
  }
  if (status === 401 || status === 403) {
    return "서버에 등록된 Gemini API 키가 유효하지 않거나 권한이 없습니다. 관리자에게 문의해 주세요.";
  }
  if (status === 404) {
    return "선택한 AI 모델을 현재 사용할 수 없습니다. 다른 모델(Gemini 3.5 Flash-Lite 등)로 다시 시도해 주세요.";
  }
  if (status === 429) {
    return "현재 요청이 많아 AI 무료 호출 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status === 500 || status === 503) {
    return "Gemini AI 서버가 일시적으로 혼잡합니다. 잠시 후 다시 시도해 주세요.";
  }
  return `AI 문제 생성 중 오류가 발생했습니다. (${status}${rawMsg ? `: ${rawMsg}` : ""})`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: { message: "허용되지 않은 요청 방식입니다." } });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: {
        message: "서버에 GEMINI_API_KEY 환경변수가 설정되지 않았습니다. Vercel 설정을 확인해 주세요.",
      },
    });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: { message: "잘못된 JSON 요청입니다." } });
  }

  const studyText = String(body.studyText || "").trim().slice(0, 80000);
  if (studyText.length < 30) {
    return res.status(400).json({
      error: { message: "학습 내용을 최소 30자 이상 입력해 주세요." },
    });
  }

  const questionType = ALLOWED_TYPES.includes(body.questionType)
    ? body.questionType
    : "multiple_choice";
  const questionCount = ALLOWED_COUNTS.includes(Number(body.questionCount))
    ? Number(body.questionCount)
    : 5;
  const targetModel = ALLOWED_MODELS.includes(body.model)
    ? body.model
    : "gemini-3.5-flash-lite";

  const typeInstructionMap = {
    multiple_choice:
      "모든 문제를 4지선다 '객관식(multiple_choice)'으로 출제하세요. options 배열에 번호(1., A. 등) 없이 보기 4개를 넣고, answer에는 options 중 정답인 문자열을 정확히 동일하게 넣으세요.",
    short_answer:
      "모든 문제를 핵심 개념이나 용어를 묻는 단답형 '주관식(short_answer)'으로 출제하세요. options는 빈 배열 []로 두고, answer에는 대표 모범 답안을, acceptableAnswers에는 띄어쓰기 변형·동의어·영문/한글 병기 등 정답으로 인정할 수 있는 표현들을 2~5개 포함하세요.",
    ox:
      '모든 문제를 참/거짓을 판별하는 \'OX 퀴즈(ox)\'로 출제하세요. 옳은 진술과 틀린 진술을 적절히 섞고, options는 ["O", "X"]로, answer는 반드시 "O" 또는 "X" 중 하나로만 작성하세요.',
    mixed:
      "객관식(multiple_choice), 주관식(short_answer), OX 퀴즈(ox)를 골고루 섞어서 출제하세요. 각 문제의 type에 맞는 options, answer, acceptableAnswers 규칙을 엄격히 지키세요.",
  };

  const systemInstruction = `당신은 대한민국 학생들을 위한 최고 수준의 시험 출제 전문가 'Study Mate AI'입니다.
사용자가 제공한 교재 또는 필기 내용만을 기반으로 정확하고 학습 효과가 높은 시험 문제를 출제하세요.

[출제 원칙]
1. 반드시 사용자가 입력한 학습 내용에 근거하여 출제하고, 지문에 없는 억지 추론은 피하세요.
2. 정확히 ${questionCount}개의 문제를 생성하세요.
3. 문제 유형 규칙: ${typeInstructionMap[questionType]}
4. 모든 문제(question), 보기(options), 정답(answer), 해설(explanation)은 자연스러운 한국어로 작성하세요.
5. 문제 분류 태그(category) 규칙:
   - 절대 문제의 정답, 보기, 지문의 핵심 개념어, 정답을 유추할 수 있는 단어를 넣지 마세요.
   - 반드시 '기초 개념', '개념 이해', '응용', '기억력' 중 정답과 무관한 일반적인 학습 유형 분류 1개만 선택하세요.
6. 해설(explanation)은 왜 그것이 정답인지(그리고 오답이 왜 틀렸는지) 학습 내용의 핵심 원리를 짚어주며 친절하게 2~3문장으로 설명하세요.
7. quizTitle은 학습 내용의 주제를 잘 나타내는 간결한 한국어 제목으로 작성하세요.`;

  const responseSchema = {
    type: "OBJECT",
    properties: {
      quizTitle: {
        type: "STRING",
        description: "학습 내용 기반의 간결한 시험 제목",
      },
      questions: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "INTEGER" },
            type: {
              type: "STRING",
              enum: ["multiple_choice", "short_answer", "ox"],
            },
            category: {
              type: "STRING",
              enum: SAFE_GENERAL_TAGS,
              description:
                "정답이나 핵심 개념과 무관한 일반 문제 분류(기초 개념, 개념 이해, 응용, 기억력 중 택1)",
            },
            question: { type: "STRING" },
            options: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            answer: { type: "STRING" },
            acceptableAnswers: {
              type: "ARRAY",
              items: { type: "STRING" },
            },
            explanation: { type: "STRING" },
          },
          required: ["id", "type", "category", "question", "answer", "explanation"],
        },
      },
    },
    required: ["quizTitle", "questions"],
  };

  const payload = {
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `다음 학습 내용을 분석하여 정확히 ${questionCount}개의 시험 문제를 생성해 주세요.\n\n[학습 내용]\n${studyText}`,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
    },
  };

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        targetModel
      )}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify(payload),
      }
    );

    const rawBodyText = await geminiRes.text();
    let data = {};
    try {
      data = rawBodyText ? JSON.parse(rawBodyText) : {};
    } catch {
      data = {};
    }

    if (!geminiRes.ok) {
      const msg = mapApiErrorMessage(geminiRes.status, data?.error?.message);
      return res.status(geminiRes.status).json({ error: { message: msg } });
    }

    const candidate = data?.candidates?.[0];
    if (!candidate) {
      const blockReason = data?.promptFeedback?.blockReason;
      const msg = blockReason
        ? `안전 정책으로 인해 요청이 차단되었습니다. (${blockReason}) 입력 내용을 조금 수정해 다시 시도해 주세요.`
        : "AI로부터 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.";
      return res.status(502).json({ error: { message: msg } });
    }

    if (candidate.finishReason === "SAFETY") {
      return res.status(400).json({
        error: { message: "안전 필터에 의해 문제 생성이 중단되었습니다. 학습 내용을 확인해 주세요." },
      });
    }

    const rawText = (candidate.content?.parts || [])
      .filter((p) => !p.thought && typeof p.text === "string")
      .map((p) => p.text)
      .join("")
      .trim();

    if (!rawText) {
      return res.status(502).json({
        error: { message: "AI 응답이 비어 있습니다. 다시 시도해 주세요." },
      });
    }

    let parsed;
    try {
      const cleaned = rawText.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({
        error: { message: "AI가 생성한 문제 형식을 해석하는 데 실패했습니다. 다시 시도해 주세요." },
      });
    }

    if (!Array.isArray(parsed.questions) || parsed.questions.length === 0) {
      return res.status(502).json({
        error: {
          message: "생성된 문제가 없습니다. 학습 내용을 조금 더 구체적으로 입력한 뒤 다시 시도해 주세요.",
        },
      });
    }

    return res.status(200).json(parsed);
  } catch {
    return res.status(500).json({
      error: { message: "서버와 Gemini AI 통신 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
    });
  }
};