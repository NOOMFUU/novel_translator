require('dotenv').config();
// ใช้ fetch ยิงตรงไปที่ API เลย เพื่อตัดปัญหาเรื่อง Library เอ๋อ
const apiKey = process.env.GEMINI_API_KEY;
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

async function listModels() {
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.models) {
      console.log("=== รายชื่อโมเดลที่ใช้ได้ ===");
      data.models.forEach(m => {
        // กรองเอาเฉพาะตัวที่ generateContent ได้
        if (m.supportedGenerationMethods.includes("generateContent")) {
            console.log(`- ${m.name.replace('models/', '')}`); 
        }
      });
    } else {
      console.error("เกิดข้อผิดพลาด:", data);
    }
  } catch (error) {
    console.error("Connection Error:", error);
  }
}

listModels();