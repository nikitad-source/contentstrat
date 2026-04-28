require('dotenv').config();
const fetch = require('node-fetch');

async function listModels() {
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const URL = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;

  console.log('Fetching models...');
  
  try {
    const response = await fetch(URL);
    const data = await response.json();
    if (data.error) {
      console.error('API Error:', data.error);
    } else {
      const pro = data.models.find(m => m.name.includes('gemini-3.1-pro-preview'));
      console.log('Model Details:', JSON.stringify(pro, null, 2));
    }
  } catch (err) {
    console.error('Network Error:', err.message);
  }
}

listModels();
