"use strict";
const { getPool, getSessionUser, sendJson, readJson, sameOrigin } = require("../lib/auth");

const MAX_MESSAGE = 4000;
const HANDOFF_RE = /\\b(human|real person|live agent|customer support|talk to (a |)person|speak to (a |)person|support agent|representative)\\b/i;

const HELP_TOPICS = [
  [/\\b(register|sign ?up|create (an? )?account|new account)\\b/i,
    "To create an account, open **My account / Sign in**, choose **Create account**, enter your name and email, then follow the email-verification link or code. After verification, sign in and open the dashboard. Never share your password or verification code with support."],
  [/\\b(login|log in|sign ?in|cannot access|can't access|locked out|password)\\b/i,
    "To sign in, open **My account** and use the email and password registered with VerifyFlow. For a forgotten password, use **Forgot password** on the sign-in page and follow the reset email. Check your spam/junk folder too. If the reset email does not arrive, ask for a human support agent."],
  [/\\b(email|verify(ing|ication)?|verification link|verification code|confirm email|resend)\\b/i,
    "Email verification is required before you can use account features. Open the latest VerifyFlow verification email and follow its link. Check spam/junk and make sure you are checking the same email address you registered with. Use the **Resend verification email** option on the account page if available. An expired link should be replaced by a newly requested one."],
  [/\\b(otp|sms code|text message|sms not|code not|no code|not received|waiting for code)\\b/i,
    "For an SMS verification order, first complete checkout and confirm the order appears in **Dashboard → Recent orders**. The assigned phone number appears on the order. The verification code and received SMS text appear there once the supplier delivers them; use **Check for SMS** to refresh while waiting. Some services take longer or may expire. Never send the OTP to anyone, including support. If the order stays waiting or expires, request human support with your order number."],
  [/\\b(phone number|number rental|rent(al)?|long.?term|dedicated number)\\b/i,
    "Open the **Long-term numbers** or **Dedicated numbers** category, choose an available country/service and review the displayed duration and price before checkout. After payment, check **Recent orders** for the order status and any number or activation details. Availability and permitted durations depend on the selected service."],
  [/\\b(esim|e-sim|qr code|activation)\\b/i,
    "Open **eSIM data**, compare the available plans and coverage details, then choose the plan that matches your device and destination before paying. After an order is fulfilled, check the order details for the activation information. Your device must support eSIM and be carrier-unlocked. Do not delete an installed eSIM profile unless your provider's instructions tell you to."],
  [/\\b(proxy|proxies|ip address|gateway)\\b/i,
    "Open **Mobile proxies** and review each plan's type, duration, availability and price. After a successful order, use the order details in your account for any connection information supplied for that plan. Keep proxy credentials private and never post them in a public chat."],
  [/\\b(smm|social media|boost|followers|likes|views|comments|subscribers|instagram|tiktok|youtube)\\b/i,
    "For **Social Media Boosters**, choose a published service, paste the public profile/post URL requested on the product card, and enter a quantity within the displayed minimum and maximum. Verify the URL carefully before checkout. After Monnify confirms payment, the selected service is submitted to its configured fulfilment API when live fulfilment is enabled. Progress can take time and depends on the service and target account. Do not submit private links or change the target while the order is processing."],
  [/\\b(link|url|target|profile|post)\\b/i,
    "For Social Media Boosters, use the public URL of the exact profile, post, video or content item requested by that service. Make sure it opens without logging in and belongs to the correct platform. A wrong or private URL can prevent a supplier from completing the order."],
  [/\\b(quantity|minimum|maximum|units)\\b/i,
    "Enter a whole-number quantity that is between the minimum and maximum shown on the product card. The estimated SMM total is calculated from the retail rate per 1,000 and your selected quantity. The server checks the product, quantity and final quote again during checkout."],
  [/\\b(payment|pay(ment)?|card|checkout|monnify|declined|failed payment)\\b/i,
    "VerifyFlow currently presents secure checkout through Monnify where the account and payment environment permit it. Return to your dashboard after checkout and check the order/payment status. A checkout page closing does not by itself prove payment succeeded. Do not pay again while an earlier payment is still pending; ask human support to review the order number if the status does not update."],
  [/\\b(paid|payment successful|deducted|debited|charged|money gone|not delivered|not working|stuck|pending order)\\b/i,
    "A successful bank/card debit and a fulfilled supplier order are separate steps. VerifyFlow must confirm the payment with Monnify before supplier fulfilment can begin. Check **Dashboard → Recent orders** for the latest status. If payment is confirmed but the service is still processing, allow the supplier to update; if it remains stuck or shows failed, request a human review with your order number. Never send full card details or banking passwords."],
  [/\\b(refund|money back|reversal|reverse|cancel order|cancel)\\b/i,
    "Refunds and reversals require an order/payment review. I cannot approve or promise a refund in this chat. Please request a human support agent and provide your VerifyFlow order number plus a short description. Never send full card details, banking passwords or OTPs."],
  [/\\b(order history|recent orders|order status|track|tracking|where is my order)\\b/i,
    "Sign in and open the dashboard. The **Recent orders** section shows your order number, product and current status. SMS verification orders also show their assigned number and display the OTP/SMS text when received. Use the refresh control on an SMS order if it is still waiting. For payment or fulfilment problems, share only the order number with human support."],
  [/\\b(account|profile|details|change email|change name)\\b/i,
    "Open **My account** to review your profile and account options. For account changes that are not available on the page, request human support. Support will never need your password, OTP, full card number or secret key."],
  [/\\b(supplier|provider|api key|admin|backend|internal)\\b/i,
    "VerifyFlow keeps supplier connections and operational credentials private. Customers only need the product, price, order status and their own delivery details. For an order issue, I can connect you to customer support without exposing internal supplier information."]
];

function buildAssistantReply(message) {
  const question = String(message || "").trim();
  for (const [pattern, answer] of HELP_TOPICS) {
    if (pattern.test(question)) return answer;
  }
  return "I can guide you through VerifyFlow accounts and email verification, SMS verification, rentals, eSIM, proxies, Social Media Boosters, checkout and order tracking. Please describe the page or step where you are stuck. For a payment/order review or anything I cannot resolve, tap **Talk to customer support** and an admin will reply in this chat.";
}

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
  let body;
  try { body = await readJson(req); }
  catch { return sendJson(res,400,{ok:false,error:"Please send a valid support message."}); }
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
    if (wantsHuman) {
      await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,message) VALUES($1,'assistant',$2)",[conversation.id,"I've passed this conversation to our human support team. An admin will reply here as soon as possible."]);
    }
    return sendJson(res,200,{ok:true,status:"human",handedOff:wantsHuman,message:wantsHuman ? "Your message has been sent to human support." : "Your message has been added to the conversation."});
  }

  const reply = buildAssistantReply(message);
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
  let body;
  try { body=await readJson(req); } catch { return sendJson(res,400,{ok:false,error:"Please submit a valid reply."}); }
  const id=String(body.conversationId||""), message=cleanMessage(body.message);
  if (!id || !message) return sendJson(res,400,{ok:false,error:"Conversation and reply are required."});
  const exists=await db.query("SELECT id FROM vf_support_conversations WHERE id=$1 AND status <> 'closed'",[id]);
  if (!exists.rowCount) return sendJson(res,404,{ok:false,error:"Open conversation not found."});
  await db.query("INSERT INTO vf_support_messages(conversation_id,sender_role,sender_user_id,message) VALUES($1,'admin',$2,$3)",[id,user.id,message]);
  await db.query("UPDATE vf_support_conversations SET status='human',last_message_at=NOW(),updated_at=NOW() WHERE id=$1",[id]);
  return sendJson(res,200,{ok:true,message:"Reply sent."});
}
module.exports = async function handler(req,res) {
  try {
    if ((req.query && String(req.query.path || "").startsWith("admin/support")) || (req.url && new URL(String(req.url),"https://verifyflow.invalid").pathname.includes("/admin/support"))) return await admin(req,res);
    return await customer(req,res);
  } catch(error) {
    console.error("[support]",error.code||error.message);
    return sendJson(res,503,{ok:false,error:"Customer support is temporarily unavailable."});
  }
};
module.exports.buildAssistantReply = buildAssistantReply;
