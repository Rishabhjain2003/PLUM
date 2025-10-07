# Wellness Board Server

Create a `.env` file with:

- GEMINI_API_KEY
- MONGODB_URI
- MONGODB_DB (optional)
- PORT (default 5000)

Scripts:

- npm run dev — start with nodemon
- npm start — start with node

Endpoints:

- POST /api/profile — { age:number, gender:string, goal:string }
- POST /api/tips/generate — { age:number, gender:string, goal:string }
- POST /api/tips/detail — { age:number, gender:string, goal:string, tip_title:string }
- POST /api/tips/save — { userId:string, tip:{ title, icon_keyword, explanation_long, steps:string[] } }
- GET /api/tips/saved/:userId
