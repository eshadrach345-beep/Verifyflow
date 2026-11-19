"use strict";
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../lib/auth");

const MAX_MESSAGE = 4000;
const HANDOFF_RE = /\b(human|real person|live agent|customer support|talk to (a |)person|speak to (a |)person|support agent|representative)\b/i;
const SYSTEM_PROMPT = [
  "You are VerifyFlow's customer help assistant.",
  "Help customers understand how to use the VerifyFlow website: account registration and sign-in, email verification, browsing categories, SMS verification, number rentals, dedicated numbers, eSIM, mobile proxies, Social Media Boosters, checkout, payments, and viewing orders.",
  "Be friendly, concise, practical, and honest. Give step-by-step website guidance when useful.",
  "Never claim to have accessed or changed a customer's account, payment, order, phone number, supplier request, or refund. You cannot perform account actions.",
  "Never invent product availability, prices, payment confirmations, delivery times, refund decisions, or policies. Tell the customer where to check or offer a human support handoff.",
  "Never reveal internal supplier names, supplier IDs, API details, admin tools, credentials, internal routing, or private operational information.",
  "For payment/order-specific cases, ask the customer to share their order number (never passwords, OTPs, full card numbers, or secret keys) and offer human support if account review is needed.",
  "If unsure, say so clearly and offer to connect the customer to a human support agent."
].join(" ");

function isAdmin(user) {
  const allowed = String(process.env.VERIFYFLOW_ADMIN_EMAILS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(user.email || "").toLowerCase());
}
function cleanMessage(value) {
  return String(value || "").trim().slice(0, MAX_MESSAGE);
}
async function customer(req, res) {
  const user = await getSessionUser(req);
  if (!user) return sendJson(res, 401, { ok:false, error:"Please sign in to contact VerifyFlow support." });
  const db = getPool();
  if (req.method === "GET") {
    const c = await db.query(
      "SELECT id,status,subject,created_at,updated_at FROM vf_support_conversations WHERE user_id=$1 AND status <> 'closed' ORDER BY updated_at DESC LIMIT 1",
      [user.id]
    );
    if (!c.rowCount) return sendJson(res, 200, {ok:true,conversation:null,messages:[]});
    const m = await db.query(
      "SELECT id,sender_role,message,created_at FROM vf_support_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 60",
      [c.rows[0].id]
    );
    return sendJson(res, 200, {ok:true,conversation:c.rows[0],messages:m.rows.reverse()});
  }
  if (req.method !== "POST") {
    res.setHeader("Allow","GET, POST");
    return sendJson(res,405,{ok:false,error:"Method not allowed."});
  }
  if (!sameOrigin(req)) return sendJson(res,403,{ok:false,error:"Request origin not allowed."});
  const body = await readJson(req);
  const message = cleanMessage(body.message);
  const wantsHuman = body.handoff === true || HANDOFF_RE.test(message);
  if (!message && !wantsHuman) return sendJson(res,400,{ok:false,error:"Enter a message first."});
  if (!message && wantsHuman) {
    const prior = await db.query("SELECT id FROM vf_support_conversations WHERE user_id=$1 AND status <> 'closed' ORDER BY updated_at DESC LIMIT 1",[user.id]);
    if (!prior.rowCount) return sendJson(res,400,{ok:false,error:"Send a short message so our support team knows what you need help with."});
  }
  const recent = await db.query(
    "SELECT count(*)::int AS n FROM vf_support_messages m JOIN vf_support_conversations c ON c.id=m.conversation_id WHERE c.user_id=$1 AND m.sender_role='customer' AND m.created_at > NOW()-INTERVAL '1 minute'",
    [user.id]
  );
  if (recent.rows[0].n >= 12) return sendJson(res,429,{ok:false,error:"Please wait a moment before sending another message."});

  let conv = await db.query("SELECT id,status FROM vf_support_conversations WHERE user_id=$1 AND status <> 'closed' ORDER BY updated_at DESC LIMIT 1",[user.id]);
  if (!conv.rowCount) conv = await db.query("INSERT INTO vf_support_conversations(user_id,status) VALUES($1,'ai') RETURNING id,status",[user.id]);
  const conversation = conv.rows[0];
  if (message) await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,sender_user_id,message) VALUES($1,'customer',$2,$3)",[conversation.id,user.id,message]);

  if (wantsHuman || conversation.status === "human") {
    await db.query("UPDATE vf_support_conversations SET status='human',last_message_at=NOW(),updated_at=NOW() WHERE id=$1",[conversation.id]);
    if (wantsHuman && !message) {
      await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,message) VALUES($1,'assistant',$2)",[conversation.id,"Your request is with our human support team. An admin will reply here as soon as possible."]);
    } else if (wantsHuman) {
      await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,message) VALUES($1,'assistant',$2)",[conversation.id,"I've passed this conversation to our human support team. An admin will reply here as soon as possible."]);
    }
    return sendJson(res,200,{ok:true,status:"human",handedOff:true,message:"Your message has been sent to human support."});
  }

  const history = await db.query(
    "SELECT sender_role,message FROM vf_support_messages WHERE conversation_id=$1 ORDER BY created_at DESC LIMIT 12",
    [conversation.id]
  );
  const transcript = history.rows.reverse().map(x => ({role:x.sender_role === "customer" ? "user" : "assistant",content:x.message}));
  let reply;
  if (!process.env.OPENAI_API_KEY) {
    reply = "I can help with general VerifyFlow website questions, but the AI assistant is not fully configured yet. You can tap “Talk to customer support” and an admin will reply here.";
  } else {
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method:"POST",
        headers:{"Authorization":"Bearer "+process.env.OPENAI_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({model:process.env.VERIFYFLOW_SUPPORT_AI_MODEL || "gpt-4o-mini",temperature:0.3,max_tokens:350,messages:[{role:"system",content:SYSTEM_PROMPT},...transcript]})
      });
      const data = await response.json().catch(()=>({}));
      if (!response.ok) throw new Error("AI provider request failed: "+response.status);
      reply = cleanMessage(data.choices?.[0]?.message?.content);
      if (!reply) throw new Error("AI provider returned an empty response.");
    } catch (error) {
      console.error("[support/chat-ai]",error.message);
      reply = "I'm having trouble answering right now. I can pass this conversation to our human support team—tap “Talk to customer support” and an admin will reply here.";
    }
  }
  await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,message) VALUES($1,'assistant',$2)",[conversation.id,reply]);
  await db.query("UPDATE vf_support_conversations SET last_message_at=NOW(),updated_at=NOW() WHERE id=$1",[conversation.id]);
  return sendJson(res,200,{ok:true,status:"ai",reply});
}

async function admin(req,res) {
  const user = await getSessionUser(req);
  if (!user) return sendJson(res,401,{ok:false,error:"Please sign in."});
  if (!isAdmin(user)) return sendJson(res,403,{ok:false,error:"Not authorized."});
  const db = getPool();
  if (req.method === "GET") {
    const id = String(req.query?.conversationId || "");
    if (id) {
      const result = await db.query(
        "SELECT c.id,c.status,c.subject,c.created_at,c.updated_at,u.email,u.full_name FROM vf_support_conversations c JOIN vf_users u ON u.id=c.user_id WHERE c.id=$1 LIMIT 1",[id]
      );
      if (!result.rowCount) return sendJson(res,404,{ok:false,error:"Conversation not found."});
      const messages = await db.query("SELECT id,sender_role,message,created_at FROM vf_support_messages WHERE conversation_id=$1 ORDER BY created_at ASC LIMIT 100",[id]);
      return sendJson(res,200,{ok:true,conversation:result.rows[0],messages:messages.rows});
    }
    const rows = await db.query(
      "SELECT c.id,c.status,c.subject,c.last_message_at,c.created_at,u.email,u.full_name,(SELECT message FROM vf_support_messages m WHERE m.conversation_id=c.id ORDER BY created_at DESC LIMIT 1) AS last_message FROM vf_support_conversations c JOIN vf_users u ON u.id=c.user_id WHERE c.status <> 'closed' ORDER BY CASE c.status WHEN 'human' THEN 0 ELSE 1 END,c.last_message_at DESC LIMIT 100"
    );
    return sendJson(res,200,{ok:true,conversations:rows.rows});
  }
  if (req.method !== "POST") {
    res.setHeader("Allow","GET, POST");
    return sendJson(res,405,{ok:false,error:"Method not allowed."});
  }
  if (!sameOrigin(req)) return sendJson(res,403,{ok:false,error:"Request origin not allowed."});
  const body=await readJson(req), id=String(body.conversationId||""), message=cleanMessage(body.message);
  if (!id || !message) return sendJson(res,400,{ok:false,error:"Conversation and reply are required."});
  const exists=await db.query("SELECT id FROM vf_support_conversations WHERE id=$1 AND status <> 'closed'",[id]);
  if (!exists.rowCount) return sendJson(res,404,{ok:false,error:"Open conversation not found."});
  await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,sender_user_id,message) VALUES($1,'admin',$2,$3)",[id,user.id,message]);
  await db.query("UPDATE vf_support_conversations SET status='human',last_message_at=NOW(),updated_at=NOW() WHERE id=$1",[id]);
  return sendJson(res,200,{ok:true,message:"Reply sent."});
}
module.exports = async function handler(req,res) {
  try {
    if (req.url && new URL(String(req.url),"https://verifyflow.invalid").pathname.includes("/admin/support")) return await admin(req,res);
    return await customer(req,res);
  } catch(error) {
    console.error("[support]",error.code||error.message);
    return sendJson(res,503,{ok:false,error:"Customer support is temporarily unavailable."});
  }
};
