// @ts-nocheck
/* eslint-disable */
import React from 'react';
// @ts-nocheck
/* eslint-disable */
/* 
  NOTE: This file uses JSX/JavaScript style in a TypeScript project.
  The @ts-nocheck directive above disables all TypeScript errors for this file.
  This is intentional — the app is written in plain JS/JSX syntax.
*/
import { useState, useEffect, useRef, useCallback } from 'react';

/* ═══════════════════════════════════════════════════════════
   CONSTANTS & CONFIG
═══════════════════════════════════════════════════════════ */
const OWNER_EMAIL = 'janethooks85@gmail.com';
const OWNER_PASS = 'yorkie2024';

// EmailJS config — sign up free at emailjs.com, create a service + template, paste IDs here
// Template variables used: {{to_email}}, {{to_name}}, {{subject}}, {{message}}, {{reply_to}}
const EMAILJS_SERVICE = 'service_ggi5lxk'; // replace with your EmailJS Service ID
const EMAILJS_TEMPLATE_OWNER = 'template_9zzc9wf'; // template for owner notification
const EMAILJS_TEMPLATE_APPLICANT = 'template_837vlyf'; // template for applicant confirmation
const EMAILJS_PUBLIC_KEY = '7CW75A1Bi0yiZPSSy'; // replace with your EmailJS public key
// Loads EmailJS SDK once
let _ejsReady = false;
async function loadEmailJS() {
  if (_ejsReady) return;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js";
    s.onload = () => { window.emailjs.init(EMAILJS_PUBLIC_KEY); _ejsReady = true; res(); };
    s.onerror = rej;
    document.head.appendChild(s);
  });
}

/* ═══════════════════════════════════════════════════════════
   LOCAL DATABASE
═══════════════════════════════════════════════════════════ */
const DB = {
  g: (k: string) => { try { return JSON.parse(localStorage.getItem(k) || "[]"); } catch { return []; } },
  s: (k: string, v) => localStorage.setItem(k, JSON.stringify(v)),
  dogs:    () => DB.g("jcyr5_dogs"),
  sDogs:   (v) => DB.s("jcyr5_dogs", v),
  apps:    () => DB.g("jcyr5_apps"),
  sApps:   (v) => DB.s("jcyr5_apps", v),
  gal:     () => DB.g("jcyr5_gal"),
  sGal:    (v) => DB.s("jcyr5_gal", v),
};

const uid  = () => { try { return crypto.randomUUID(); } catch(_){ return Math.random().toString(36).slice(2) + Date.now().toString(36); } };
const ts   = () => new Date().toISOString();
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

/* ═══════════════════════════════════════════════════════════
   BACKEND API
═══════════════════════════════════════════════════════════ */
const API = {
  async getDogs()       { return DB.dogs(); },
  async addDog(d) { await wait(100); const n={...d,id:uid(),createdAt:ts(),status:"available"}; DB.sDogs([n,...DB.dogs()]); return n; },
  async updateDog(id, u) { await wait(240); const a=DB.dogs().map((d: any) =>d.id===id?{...d,...u,updatedAt:ts()}:d); DB.sDogs(a); return a.find((d: any) =>d.id===id); },
  async deleteDog(id) { await wait(180); DB.sDogs(DB.dogs().filter((d: any) =>d.id!==id)); },

  async submitApp(data: any) {
    const app = {
      ...data, id: uid(), submittedAt: ts(),
      status: "approved",  // auto-approved immediately
      aiScore: null, aiSummary: null, aiFlags: null,
      aiStrengths: null, aiConcerns: null, aiRecommendation: null,
      aiLoading: true,
      emailOwnerSent: false, emailApplicantSent: false,
    };
    DB.sApps([app, ...DB.apps()]);

    // Fire AI review + owner notification + approval email in parallel
    API._aiScreen(app.id, data);
    API._sendOwnerEmail(app.id, data);
    API._sendApprovalEmail(data);  // instant approval email to client

    return app;
  },

  // ── Full AI review using Claude ──────────────────────────
  async _aiScreen(appId: any, data: any) {
    try {
      const prompt = `You are a senior adoption coordinator at Janet Companion Yorkie Rescue reviewing an adoption application. Provide a thorough assessment.

APPLICATION DETAILS:
- Dog interested in: ${data.dogName}
- Applicant: ${data.firstName} ${data.lastName}
- Location: ${data.location}
- Timeline: ${data.timeline}
- Living situation: ${data.living || "not specified"}
- Prior dog experience: ${data.experience || "not specified"}
- Message from applicant: "${data.message}"

Respond ONLY with valid JSON (no markdown, no extra text):
{
  "score": <integer 1-10>,
  "recommendation": "<one of: Highly Recommended | Recommended | Review Needed | Not Recommended>",
  "summary": "<2-3 sentence overall assessment>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "concerns": ["<concern 1>", "<concern 2>"],
  "flags": "<one concise sentence about the most important thing Janet should know>",
  "suggestedQuestions": ["<follow-up question 1>", "<follow-up question 2>"]
}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 600,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const json = await res.json();
      const raw  = json.content?.find((c: any) => c.type === "text")?.text || "{}";
      const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());
      DB.sApps(DB.apps().map((a: any) => a.id === appId ? {
        ...a,
        aiScore: parsed.score,
        aiSummary: parsed.summary,
        aiFlags: parsed.flags,
        aiStrengths: parsed.strengths || [],
        aiConcerns: parsed.concerns || [],
        aiRecommendation: parsed.recommendation,
        aiSuggestedQuestions: parsed.suggestedQuestions || [],
        aiLoading: false,
      } : a));
    } catch (_e) {
      DB.sApps(DB.apps().map((a: any) => a.id === appId ? { ...a, aiLoading: false, aiError: true } : a));
    }
  },

  // ── Auto-send email to owner (Janet) ─────────────────────
  async _sendOwnerEmail(appId: any, data: any) {
    const emailBody = `
Hi Janet! 🐾

A new adoption application has been submitted on your website.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🐕 DOG INTERESTED IN: ${data.dogName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

APPLICANT DETAILS
Name:       ${data.firstName} ${data.lastName}
Email:      ${data.email}
Phone:      ${data.phone}
Location:   ${data.location}
Timeline:   ${data.timeline}
Living:     ${data.living || "Not specified"}
Experience: ${data.experience || "Not specified"}

MESSAGE FROM APPLICANT:
"${data.message}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Application ID: ${appId.slice(0, 8).toUpperCase()}
Submitted: ${new Date().toLocaleString()}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Please log in to your owner dashboard to view the full AI review and respond.

— Janet Companion Yorkie Rescue Website`;

    try {
      await loadEmailJS();
      await window.emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE_OWNER, {
        to_email: OWNER_EMAIL,
        to_name: "Janet",
        subject: `🐾 New Adoption Application — ${data.dogName} from ${data.firstName} ${data.lastName}`,
        message: emailBody,
        reply_to: data.email,
        applicant_name: `${data.firstName} ${data.lastName}`,
        applicant_email: data.email,
        applicant_phone: data.phone,
        dog_name: data.dogName,
        location: data.location,
        timeline: data.timeline,
      });
      DB.sApps(DB.apps().map((a: any) => a.id === appId ? { ...a, emailOwnerSent: true } : a));
    } catch (err) {
      // Fallback: open mailto so the email still goes out
      const sub  = encodeURIComponent(`🐾 New Adoption Application – ${data.dogName} from ${data.firstName} ${data.lastName}`);
      const body = encodeURIComponent(emailBody);
      window.open(`mailto:${OWNER_EMAIL}?subject=${sub}&body=${body}`, "_blank");
      DB.sApps(DB.apps().map((a: any) => a.id === appId ? { ...a, emailOwnerSent: false, emailOwnerFallback: true } : a));
    }
  },

  // ── Instant approval email to client ──────────────────────
  async _sendApprovalEmail(data: any) {
    const approvalBody = `
Hi ${data.firstName}! 🎉

GREAT NEWS — Your application to adopt ${data.dogName} has been APPROVED!

Congratulations! After reviewing your application, we are thrilled to welcome you into the Janet Companion Yorkie Rescue family.

YOUR APPROVED APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━
Dog:      ${data.dogName}
Name:     ${data.firstName} ${data.lastName}
Location: ${data.location}
Timeline: ${data.timeline}
━━━━━━━━━━━━━━━━━━━━━━━━

NEXT STEPS
1. Janet will contact you at ${data.email} within 24 hours to arrange a meet & greet
2. We'll schedule a home visit or virtual tour if needed
3. You'll sign the official Adoption Contract
4. Transfer of Ownership paperwork will be completed
5. ${data.dogName} comes home with you! 🐕

WHAT'S INCLUDED WITH YOUR ADOPTION ($350 fee):
✅ Adoption Contract
✅ Health Certificate
✅ Transfer of Ownership document
✅ Microchip Registration (transferred to your name)
✅ Full Vaccination Records
✅ Yorkie Care Guide

If you have any questions, please reach out directly:
📧 ${OWNER_EMAIL}

We can't wait to see ${data.dogName} in their forever home!

With love,
Janet
Janet Companion Yorkie Rescue
${OWNER_EMAIL}`;

    try {
      await loadEmailJS();
      await window.emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE_APPLICANT, {
        to_email: data.email,
        to_name: `${data.firstName} ${data.lastName}`,
        subject: `🎉 APPROVED! Your Adoption of ${data.dogName} — Janet Companion Yorkie Rescue`,
        message: approvalBody,
        reply_to: OWNER_EMAIL,
        dog_name: data.dogName,
        applicant_name: data.firstName,
      });
    } catch {
      // Silent fail — owner email is the critical one
    }
  },

  async getApps()          { await wait(200); return DB.apps(); },
  async setAppStatus(id, s) { await wait(160); DB.sApps(DB.apps().map((a: any) =>a.id===id?{...a,status:s}:a)); },
  async getGal() {
    await wait(200);
    const existing = DB.gal();
    // Seed with Yorkie photos on first visit
    if (existing.length === 0) {
      const seeded = SEED_GALLERY.map((item, i) => ({
        ...item,
        id: `seed_${i}`,
        addedAt: new Date(Date.now() - (SEED_GALLERY.length - i) * 86400000).toISOString(),
        seeded: true,
      }));
      DB.sGal(seeded);
      return seeded;
    }
    return existing;
  },
  async addMedia(m) { await wait(300); const n={...m,id:uid(),addedAt:ts()}; DB.sGal([n,...DB.gal()]); return n; },
  async deleteMedia(id) { await wait(160); DB.sGal(DB.gal().filter((g: any) =>g.id!==id)); },
};

/* ═══════════════════════════════════════════════════════════
   SEED GALLERY — 12 real Yorkie photos (Unsplash / Pexels CDN)
   All free for use, no attribution required
═══════════════════════════════════════════════════════════ */
const SEED_GALLERY = [
  {
    src: "",
    type: "image",
    caption: "Sweet little Yorkie 🐾",
  },
  {
    src: "https://images.pexels.com/photos/4587998/pexels-photo-4587998.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Ready for a forever home",
  },
  {
    src: "https://images.pexels.com/photos/3361739/pexels-photo-3361739.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Adorable pup looking for love 💛",
  },
  {
    src: "https://images.pexels.com/photos/1254140/pexels-photo-1254140.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Fluffy and full of joy",
  },
  {
    src: "https://images.pexels.com/photos/4498216/pexels-photo-4498216.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Tiny paws, big heart 🐕",
  },
  {
    src: "https://images.pexels.com/photos/3860306/pexels-photo-3860306.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Playful and curious",
  },
  {
    src: "https://images.pexels.com/photos/2607544/pexels-photo-2607544.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Beautiful silky coat",
  },
  {
    src: "https://images.pexels.com/photos/1805164/pexels-photo-1805164.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Happy best friends",
  },
  {
    src: "https://images.pexels.com/photos/3361741/pexels-photo-3361741.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Golden afternoon nap ☀️",
  },
  {
    src: "https://images.pexels.com/photos/2023384/pexels-photo-2023384.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Pure Yorkshire Terrier charm",
  },
  {
    src: "https://images.pexels.com/photos/1458925/pexels-photo-1458925.jpeg?auto=compress&cs=tinysrgb&w=400&h=500&fit=crop",
    type: "image",
    caption: "Snuggle time 🤍",
  },
  {
    src: "https://images.pexels.com/photos/4498217/pexels-photo-4498217.jpeg?auto=compress&cs=tinysrgb&w=600",
    type: "image",
    caption: "Adventures await 🌿",
  },
];

/* ═══════════════════════════════════════════════════════════
   GLOBAL CSS — Warm Luxury Editorial
═══════════════════════════════════════════════════════════ */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;0,900;1,400;1,700&family=Jost:wght@300;400;500;600;700&display=swap');

*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{background:#faf6f0;color:#2c1810;font-family:'Jost',sans-serif;overflow-x:hidden;line-height:1.6}

:root{
  --ivory:#faf6f0;
  --ivory2:#f3ece0;
  --ivory3:#e8dcc8;
  --warm:#c4793a;
  --warm2:#e8955a;
  --warm3:#f5b07a;
  --terracotta:#a0522d;
  --deep:#2c1810;
  --deep2:#4a2a18;
  --deep3:#6b3a20;
  --sand:#d4b896;
  --sand2:#e8d5bc;
  --sage:#7a9a7a;
  --rose:#c4686a;
  --gold:#c8960c;
  --t2:rgba(44,24,16,.65);
  --t3:rgba(44,24,16,.38);
  --bd:rgba(196,121,58,.22);
  --bd2:rgba(196,121,58,.42);
}

::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:#f3ece0}
::-webkit-scrollbar-thumb{background:var(--warm);border-radius:3px}

/* ── Fonts ── */
.serif{font-family:'Playfair Display',serif}
.sans{font-family:'Jost',sans-serif}

/* ── Keyframes ── */
@keyframes fadeUp    {from{opacity:0;transform:translateY(38px)}to{opacity:1;transform:none}}
@keyframes fadeIn    {from{opacity:0}to{opacity:1}}
@keyframes scaleIn   {from{opacity:0;transform:scale(.92)}to{opacity:1;transform:none}}
@keyframes slideDown {from{opacity:0;transform:translateY(-14px)}to{opacity:1;transform:none}}
@keyframes float     {0%,100%{transform:translateY(0)}50%{transform:translateY(-11px)}}
@keyframes spin      {to{transform:rotate(360deg)}}
@keyframes shimmer   {0%{background-position:-700px 0}100%{background-position:700px 0}}
@keyframes toastPop  {from{opacity:0;transform:translateX(20px) scale(.93)}to{opacity:1;transform:none}}
@keyframes gradMove  {0%,100%{background-position:0 50%}50%{background-position:100% 50%}}
@keyframes pulse     {0%,100%{opacity:1}50%{opacity:.4}}
@keyframes borderGlow{0%,100%{box-shadow:0 0 0 0 rgba(196,121,58,.3)}50%{box-shadow:0 0 0 6px rgba(196,121,58,.08)}}
@keyframes popIn     {0%{opacity:0;transform:scale(.6) rotate(-10deg)}80%{transform:scale(1.08) rotate(2deg)}100%{opacity:1;transform:none}}

/* ── Details/Summary ── */
details>summary{list-style:none}
details>summary::-webkit-details-marker{display:none}
details[open]>summary{margin-bottom:6px}

/* ── AI review grid ── */
@media(max-width:500px){
  .ai-sc-grid{grid-template-columns:1fr!important}
}

/* ── Scroll Reveal ── */
.sr    {opacity:0;transform:translateY(40px);transition:opacity .8s cubic-bezier(.4,0,.2,1),transform .8s cubic-bezier(.4,0,.2,1)}
.sr-l  {opacity:0;transform:translateX(-44px);transition:opacity .75s cubic-bezier(.4,0,.2,1),transform .75s cubic-bezier(.4,0,.2,1)}
.sr-r  {opacity:0;transform:translateX(44px);transition:opacity .75s cubic-bezier(.4,0,.2,1),transform .75s cubic-bezier(.4,0,.2,1)}
.sr-z  {opacity:0;transform:scale(.88);transition:opacity .7s cubic-bezier(.4,0,.2,1),transform .7s cubic-bezier(.4,0,.2,1)}
.sr-r2 {opacity:0;transform:rotate(-4deg) translateY(28px);transition:opacity .7s ease,transform .7s ease}
.sr.in,.sr-l.in,.sr-r.in,.sr-z.in,.sr-r2.in{opacity:1!important;transform:none!important}

/* ── Skeleton ── */
.sk{background:linear-gradient(90deg,#ede3d4 25%,#f5ece0 50%,#ede3d4 75%);background-size:700px 100%;animation:shimmer 1.5s infinite;border-radius:10px}

/* ── Focus ── */
input:focus,textarea:focus,select:focus{outline:none;border-color:var(--warm)!important;box-shadow:0 0 0 3px rgba(196,121,58,.12)}
input,textarea,select{font-family:'Jost',sans-serif}

/* ── Responsive grid helpers ── */
.cols-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.cols-3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.auto-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px}
.masonry-grid{columns:3 200px;gap:14px}

/* ── Mobile nav overlay ── */
.mob-nav{
  position:fixed;inset:0;z-index:350;background:var(--ivory);
  display:flex;flex-direction:column;gap:1.8rem;
  padding:82px 6vw 44px;
  animation:slideDown .24s ease;
}

/* ── Responsive ── */
@media(max-width:900px){
  .cols-2.tablet-1{grid-template-columns:1fr!important}
  .auto-cards{grid-template-columns:repeat(auto-fill,minmax(260px,1fr))}
}
@media(max-width:640px){
  .cols-2{grid-template-columns:1fr!important}
  .cols-3{grid-template-columns:1fr 1fr!important}
  .auto-cards{grid-template-columns:1fr!important;gap:18px}
  .masonry-grid{columns:2 150px!important;gap:10px!important}
  .hide-mob{display:none!important}
  .show-mob{display:flex!important}
  .sec-pad{padding:64px 5vw!important}
  .modal-body{padding:18px 16px 24px!important}
  .modal-head-pad{padding:20px 16px 16px!important}
}
@media(max-width:400px){
  .masonry-grid{columns:1!important}
}

/* ── Utility ── */
.show-mob{display:none}

@keyframes waFloat { 0%,100%{transform:translateY(0) scale(1)} 50%{transform:translateY(-6px) scale(1)} }
@keyframes waPulse { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.8);opacity:0} }

`;

/* ═══════════════════════════════════════════════════════════
   HOOKS
═══════════════════════════════════════════════════════════ */
function useToast() {
  const [toasts, set] = useState<any[]>([]);
  const add = useCallback((msg, type: string = "ok") => {
    const id = Date.now();
    set(t => [...t, {id, msg, type}]);
    setTimeout(() => set(t => t.filter(x => x.id !== id)), 3600);
  }, []);
  return { toasts, add };
}

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".sr,.sr-l,.sr-r,.sr-z,.sr-r2");
    const io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          const delay = +((e.target as HTMLElement).dataset.d || 0);
          setTimeout(() => (e.target as HTMLElement).classList.add("in"), delay);
        }
      });
    }, { threshold: 0.08, rootMargin: "0px 0px -40px 0px" });
    els.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []); // run once on mount only
}

/* ═══════════════════════════════════════════════════════════
   ATOMS
═══════════════════════════════════════════════════════════ */
function Spinner({ size = 20, color = "#c4793a" }) {
  return <div style={{width:size,height:size,borderRadius:"50%",border:`2.5px solid ${color}25`,borderTopColor:color,animation:"spin .65s linear infinite",display:"inline-block",flexShrink:0}}/>;
}

function Toasts({ toasts }) {
  return (
    <div style={{position:"fixed",bottom:20,right:20,zIndex:9999,display:"flex",flexDirection:"column",gap:8,maxWidth:300,width:"calc(100vw - 40px)"}}>
      {toasts.map((t: any) => (
        <div key={t.id} style={{
          padding:"12px 18px",borderRadius:14,fontWeight:700,fontSize:".87rem",
          background: t.type==="err" ? "#fff0ee" : "#fff8f0",
          color: t.type==="err" ? "#9a2020" : "#5a2a08",
          border:`1px solid ${t.type==="err" ? "rgba(180,50,50,.25)" : "rgba(196,121,58,.3)"}`,
          boxShadow:"0 8px 32px rgba(44,24,16,.18)",animation:"toastPop .3s ease",
          display:"flex",alignItems:"center",gap:9,lineHeight:1.4
        }}>
          {t.type==="err" ? "⚠️" : "✅"} {t.msg}
        </div>
      ))}
    </div>
  );
}

/* Button variants */
const BV = {
  primary: {background:"linear-gradient(135deg,#b86830,#e8955a)",color:"#fff",boxShadow:"0 4px 20px rgba(196,121,58,.38)"},
  outline: {background:"transparent",color:"var(--terracotta)",border:"2px solid rgba(160,82,45,.4)"},
  ghost:   {background:"rgba(196,121,58,.08)",color:"var(--terracotta)"},
  dark:    {background:"var(--deep)",color:"var(--ivory)",boxShadow:"0 4px 18px rgba(44,24,16,.3)"},
  danger:  {background:"#fff0ee",color:"#9a2020",border:"1px solid rgba(180,50,50,.3)"},
  green:   {background:"rgba(80,140,80,.1)",color:"#2d7a2d",border:"1px solid rgba(80,140,80,.3)"},
  ivory:   {background:"var(--ivory)",color:"var(--deep)",border:"2px solid rgba(44,24,16,.15)",boxShadow:"0 2px 12px rgba(44,24,16,.12)"},
};

function Btn({ children, onClick, v="primary", loading, disabled, small, full, sx={} }) {
  const variantStyle = BV[v] || BV.primary;
  return (
    <button onClick={onClick} disabled={disabled||loading} style={{
      border:"none",borderRadius:50,cursor:disabled||loading?"not-allowed":"pointer",
      fontFamily:"'Jost',sans-serif",fontWeight:700,letterSpacing:".02em",
      padding:small?"8px 18px":"13px 30px",fontSize:small?".83rem":".95rem",
      width:full?"100%":"auto",display:"inline-flex",alignItems:"center",
      justifyContent:"center",gap:8,opacity:disabled||loading ? 0.62 : 1,
      transition:"all .22s",flexShrink:0,...variantStyle,...sx,
    }}>
      {loading && <Spinner size={15} color={v==="primary"||v==="dark" ? "#fff" : "var(--warm)"}/>}
      {children}
    </button>
  );
}

function Field({ label, id, type="text", value, onChange, placeholder, required, rows, opts, err, hint }) {
  const base = {
    width:"100%",padding:"11px 14px",
    background:"rgba(250,246,240,.95)",
    border:`1.5px solid ${err ? "#b03030" : "rgba(196,121,58,.3)"}`,
    borderRadius:11,
    color:"var(--deep)",fontSize:".93rem",transition:"border-color .2s,box-shadow .2s",
  };
  return (
    <div style={{marginBottom:14}}>
      {label && (
        <label htmlFor={id} style={{display:"block",fontWeight:600,fontSize:".79rem",
          color:"var(--terracotta)",marginBottom:5,letterSpacing:".06em",textTransform:"uppercase"}}>
          {label}{required && <span style={{color:"var(--warm)"}}>*</span>}
        </label>
      )}
      {opts
        ? <select id={id} value={value} onChange={e=>onChange(e.target.value)} style={{...base,cursor:"pointer"}} required={required}>
            {opts.map(o=><option key={o.v} value={o.v} style={{background:"#fff"}}>{o.l}</option>)}
          </select>
        : rows
          ? <textarea id={id} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} rows={rows} required={required} style={{...base,resize:"vertical"}}/>
          : <input id={id} type={type} value={value} onChange={e=>onChange(e.target.value)} placeholder={placeholder} required={required} style={base}/>
      }
      {err  && <p style={{color:"#b03030",fontSize:".76rem",marginTop:4}}>{err}</p>}
      {hint && <p style={{color:"var(--t3)",fontSize:".76rem",marginTop:4}}>{hint}</p>}
    </div>
  );
}

function Modal({ open, onClose, title, sub, children, wide }) {
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);
  if (!open) return null;
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()}
      style={{position:"fixed",inset:0,zIndex:500,background:"rgba(44,24,16,.55)",backdropFilter:"blur(8px)",
        display:"flex",alignItems:"center",justifyContent:"center",padding:14,animation:"fadeIn .2s ease"}}>
      <div style={{background:wide?"var(--ivory2)":"var(--ivory)",borderRadius:24,width:"100%",
        maxWidth:wide?760:520,maxHeight:"94vh",overflowY:"auto",
        border:"1px solid rgba(196,121,58,.2)",boxShadow:"0 32px 80px rgba(44,24,16,.3)",
        animation:"scaleIn .28s cubic-bezier(.34,1.56,.64,1)"}}>
        <div className="modal-head-pad" style={{padding:"24px 28px 18px",borderBottom:"1px solid rgba(196,121,58,.15)",
          background:"linear-gradient(135deg,rgba(196,121,58,.08),transparent)",position:"relative"}}>
          {title && <h2 className="serif" style={{color:"var(--terracotta)",fontSize:"1.6rem",fontWeight:700}}>{title}</h2>}
          {sub && <p style={{color:"var(--t2)",fontSize:".85rem",marginTop:4}}>{sub}</p>}
          <button onClick={onClose} style={{position:"absolute",right:16,top:16,background:"rgba(44,24,16,.07)",
            border:"1px solid rgba(44,24,16,.12)",borderRadius:"50%",width:33,height:33,
            color:"var(--deep)",cursor:"pointer",fontSize:".9rem",display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
        </div>
        <div className="modal-body" style={{padding:"22px 28px 28px"}}>{children}</div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   NAV
═══════════════════════════════════════════════════════════ */
function Nav({ onAdmin }) {
  const [sc, setSc] = useState(false);
  const [mob, setMob] = useState(false);
  useEffect(() => {
    const h = () => setSc(window.scrollY > 50);
    window.addEventListener("scroll", h, {passive:true});
    return () => window.removeEventListener("scroll", h);
  }, []);
  const links = [["#dogs","Our Yorkies"],["#about","About Us"],["#gallery","Gallery"],["#contact","Adopt Now"]];
  return (
    <>
      <nav style={{position:"sticky",top:0,zIndex:200,height:64,
        display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 5vw",
        background:sc?"rgba(250,246,240,.97)":"rgba(250,246,240,.75)",
        backdropFilter:"blur(20px)",
        borderBottom:`1px solid rgba(196,121,58,${sc ? 0.2 : 0.08})`,
        transition:"all .32s",boxShadow:sc?"0 2px 24px rgba(44,24,16,.08)":"none"}}>

        <a href="#hero" style={{textDecoration:"none",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:"1.5rem",display:"inline-block",animation:"float 4s ease-in-out infinite"}}>🐾</span>
          <span style={{fontFamily:"'Playfair Display',serif",lineHeight:1.18}}>
            <span style={{display:"block",fontSize:"1.05rem",fontWeight:700,color:"var(--terracotta)",letterSpacing:".02em"}}>Janet Companion</span>
            <span style={{display:"block",fontSize:".7rem",fontWeight:400,color:"var(--t3)",letterSpacing:".06em",textTransform:"uppercase"}}>Yorkie Rescue</span>
          </span>
        </a>

        <div className="hide-mob" style={{display:"flex",gap:"2rem"}}>
          {links.map(([href,lbl]) => (
            <a key={href} href={href} style={{color:"var(--t2)",textDecoration:"none",fontWeight:600,fontSize:".9rem",
              transition:"color .2s",letterSpacing:".01em"}}
              onMouseEnter={e=>{const el=e.currentTarget;el.style.color="var(--warm)"}}
              onMouseLeave={e=>{const el=e.currentTarget;el.style.color="var(--t2)"}}>{lbl}</a>
          ))}
        </div>

        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <Btn small onClick={onAdmin} v="ghost">Admin</Btn>
          <button className="show-mob" onClick={()=>setMob(!mob)}
            style={{background:"rgba(196,121,58,.1)",border:"1px solid rgba(196,121,58,.25)",borderRadius:9,
              padding:"7px 8px",cursor:"pointer",flexDirection:"column",gap:4,alignItems:"center",display:"flex"}}>
            {[0,1,2].map(i=><span key={i} style={{display:"block",width:20,height:2,background:"var(--terracotta)",borderRadius:2}}/>)}
          </button>
        </div>
      </nav>

      {mob && (
        <div className="mob-nav" style={{zIndex:300}}>
          <button onClick={()=>setMob(false)} style={{position:"absolute",top:18,right:18,
            background:"rgba(196,121,58,.1)",border:"1px solid rgba(196,121,58,.25)",borderRadius:"50%",
            width:36,height:36,color:"var(--terracotta)",cursor:"pointer",fontSize:"1rem"}}>✕</button>
          {links.map(([href,lbl]) => (
            <a key={href} href={href} onClick={()=>setMob(false)} style={{
              fontFamily:"'Playfair Display',serif",fontSize:"2rem",
              color:"var(--terracotta)",fontWeight:700,textDecoration:"none"}}>
              {lbl}
            </a>
          ))}
          <Btn onClick={()=>{onAdmin();setMob(false)}} v="ghost" sx={{alignSelf:"flex-start",marginTop:8}}>Admin</Btn>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   HERO
═══════════════════════════════════════════════════════════ */
function Hero({ available }) {
  return (
    <section id="hero" style={{
      minHeight:"96vh",position:"relative",display:"flex",alignItems:"center",
      padding:"90px 5vw 80px",overflow:"hidden",
    }}>
      {/* ── Your uploaded Yorkie photo as background ── */}
      <div style={{
        position:"absolute",inset:0,zIndex:0,
        backgroundImage:`url('data:image/jpeg;base64,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')`,
        backgroundSize:"cover",
        backgroundPosition:"center 30%",
        filter:"blur(6px) brightness(0.45) saturate(0.85)",
        transform:"scale(1.07)",
      }}/>
      {/* ── Single dark overlay — makes all text fully readable, no colour tint ── */}
      <div style={{position:"absolute",inset:0,zIndex:1,background:"rgba(0,0,0,0.38)"}}/>
      {/* ── Bottom vignette for stats readability ── */}
      <div style={{position:"absolute",bottom:0,left:0,right:0,height:"40%",zIndex:1,
        background:"linear-gradient(to top,rgba(0,0,0,0.5) 0%,transparent 100%)"}}/>
      {/* Floating circles */}
      {[[20,80,60,8],[65,10,100,11],[50,85,45,7]].map(([t,l,sz,d],i) => (
        <div key={i} style={{position:"absolute",top:`${t}%`,left:`${l}%`,width:sz,height:sz,
          borderRadius:"50%",background:"rgba(255,255,255,.05)",border:"1px solid rgba(255,255,255,.08)",
          animation:`float ${d}s ease-in-out infinite`,animationDelay:`${i*2.5}s`,zIndex:2}}/>
      ))}

      <div style={{position:"relative",zIndex:3,maxWidth:700}}>
        {/* Top label */}
        <div style={{display:"inline-flex",alignItems:"center",gap:8,marginBottom:24,
          background:"rgba(245,176,122,.18)",border:"1px solid rgba(245,176,122,.38)",
          borderRadius:50,padding:"6px 18px",animation:"fadeUp .5s ease .1s both"}}>
          <span style={{fontSize:".88rem"}}>🐶</span>
          <span style={{fontSize:".73rem",fontWeight:700,color:"#f5c97a",letterSpacing:".12em",textTransform:"uppercase"}}>Yorkshire Terrier Rescue</span>
        </div>

        <h1 style={{fontFamily:"'Playfair Display',serif",
          fontSize:"clamp(2.8rem,7.5vw,5.8rem)",fontWeight:900,lineHeight:1.02,
          marginBottom:22,animation:"fadeUp .55s ease .18s both",letterSpacing:"-0.02em"}}>
          <span style={{background:"linear-gradient(135deg,#f5c97a 0%,#e8955a 45%,#f5b07a 100%)",
            backgroundSize:"200% 200%",animation:"gradMove 6s ease infinite",
            WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>Every Yorkie</span>
          <br/><span style={{color:"#fff",textShadow:"0 2px 20px rgba(0,0,0,.3)"}}>Deserves a</span>
          <br/><em style={{fontStyle:"italic",color:"rgba(255,255,255,.65)"}}>Forever Home</em>
        </h1>

        <p style={{fontSize:"1.08rem",color:"rgba(255,255,255,.82)",lineHeight:1.85,maxWidth:490,
          marginBottom:38,animation:"fadeUp .55s ease .3s both",fontWeight:400,
          textShadow:"0 1px 8px rgba(0,0,0,.4)"}}>
          Janet Companion Yorkie Rescue finds loving homes for Yorkshire Terriers — with full health certificates, legal paperwork, and official transfer of ownership included with every adoption.
        </p>

        <div style={{display:"flex",gap:13,flexWrap:"wrap",animation:"fadeUp .55s ease .42s both"}}>
          <Btn onClick={()=>document.getElementById("dogs")?.scrollIntoView({behavior:"smooth"})}>
            Meet Our Yorkies 🐾
          </Btn>
          <Btn v="ivory" onClick={()=>document.getElementById("contact")?.scrollIntoView({behavior:"smooth"})}
            sx={{background:"rgba(255,255,255,.15)",color:"#fff",border:"2px solid rgba(255,255,255,.45)",backdropFilter:"blur(4px)"}}>
            Start Adoption →
          </Btn>
        </div>

        {/* Stats */}
        <div style={{display:"flex",gap:"clamp(18px,4vw,48px)",marginTop:52,flexWrap:"wrap",
          animation:"fadeUp .55s ease .54s both"}}>
          {[[available>0?available+"":"0","Available Now"],["$350","Adoption Fee"],["100%","Vet Checked"]].map(([n,l]) => (
            <div key={l} style={{position:"relative"}}>
              <div style={{fontFamily:"'Playfair Display',serif",fontSize:"2.4rem",fontWeight:900,
                color:"#f5c97a",lineHeight:1,letterSpacing:"-0.03em",textShadow:"0 2px 12px rgba(0,0,0,.4)"}}>{n}</div>
              <div style={{fontSize:".7rem",color:"rgba(255,255,255,.55)",textTransform:"uppercase",letterSpacing:".12em",marginTop:4,fontWeight:600}}>{l}</div>
              <div style={{position:"absolute",bottom:-6,left:0,width:32,height:2,
                background:"linear-gradient(90deg,#f5c97a,transparent)",borderRadius:2}}/>
            </div>
          ))}
        </div>
      </div>

      {/* Scroll indicator */}
      <div style={{position:"absolute",bottom:32,left:"50%",transform:"translateX(-50%)",
        display:"flex",flexDirection:"column",alignItems:"center",gap:6,zIndex:3,
        animation:"fadeIn 1s ease 1.2s both"}}>
        <span style={{fontSize:".68rem",letterSpacing:".14em",textTransform:"uppercase",color:"rgba(255,255,255,.4)",fontWeight:600}}>Scroll</span>
        <div style={{width:1,height:40,background:"linear-gradient(to bottom,rgba(245,201,122,.6),transparent)"}}/>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   DOG CARD
═══════════════════════════════════════════════════════════ */
function DogCard({ dog, onAdopt, admin, onDelete, onEdit, delay=0 }) {
  const [hov, setHov] = useState(false);
  return (
    <div className="sr-z" data-d={delay}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      style={{
        background:"#fff",borderRadius:20,overflow:"hidden",
        border:`1px solid rgba(196,121,58,${hov ? .28 : .12})`,
        boxShadow:hov?"0 20px 50px rgba(44,24,16,.18),0 0 0 1px rgba(196,121,58,.15)":"0 4px 24px rgba(44,24,16,.08)",
        transform:hov?"translateY(-7px) scale(1.01)":"none",
        transition:"all .32s cubic-bezier(.34,1.4,.64,1)",
      }}>
      {/* Media */}
      <div style={{height:230,overflow:"hidden",background:"var(--ivory2)",position:"relative"}}>
        {dog.mediaType==="video"
          ? <video src={dog.mediaSrc} muted loop playsInline autoPlay style={{width:"100%",height:"100%",objectFit:"cover",transform:hov?"scale(1.07)":"scale(1)",transition:"transform .45s"}}/>
          : dog.mediaSrc
            ? <img src={dog.mediaSrc} alt={dog.name} onError={e=>{const img=e.target;img.src="https://placedog.net/400/300"}} style={{width:"100%",height:"100%",objectFit:"cover",transform:hov?"scale(1.07)":"scale(1)",transition:"transform .45s"}}/>
            : <div style={{width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"4.5rem",
                background:"linear-gradient(135deg,var(--ivory3),var(--sand2))"}}>🐕</div>
        }
        <div style={{position:"absolute",inset:0,background:"linear-gradient(to top,rgba(44,24,16,.6) 0%,transparent 50%)"}}/>
        {/* Badges */}
        <div style={{position:"absolute",top:11,left:11,display:"flex",gap:6,flexWrap:"wrap"}}>
          {dog.featured && <span style={{background:"linear-gradient(135deg,#8b3a0f,#c4793a)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:".68rem",fontWeight:700,letterSpacing:".04em"}}>⭐ FEATURED</span>}
          {dog.status==="adopted" && <span style={{background:"rgba(80,140,80,.9)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:".68rem",fontWeight:700}}>🏠 ADOPTED</span>}
          {dog.status==="pending" && <span style={{background:"rgba(196,121,58,.9)",color:"#fff",borderRadius:20,padding:"3px 12px",fontSize:".68rem",fontWeight:700}}>⏳ PENDING</span>}
        </div>
        <div style={{position:"absolute",bottom:12,left:14,right:14}}>
          <div style={{fontFamily:"'Playfair Display',serif",fontSize:"1.55rem",fontWeight:700,color:"#fff",textShadow:"0 2px 8px rgba(0,0,0,.4)"}}>{dog.name}</div>
        </div>
      </div>

      {/* Body */}
      <div style={{padding:"18px 20px 20px"}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
          {dog.age && <Tag>🎂 {dog.age}</Tag>}
          {dog.gender && <Tag>{dog.gender==="Female"?"♀️":"♂️"} {dog.gender}</Tag>}
          {dog.weight && <Tag>⚖️ {dog.weight}</Tag>}
        </div>
        <p style={{color:"var(--t2)",fontSize:".88rem",lineHeight:1.65,marginBottom:14,
          display:"-webkit-box",WebkitLineClamp:3,WebkitBoxOrient:"vertical",overflow:"hidden"}}>
          {dog.desc||"A sweet Yorkshire Terrier looking for a loving forever home."}
        </p>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
          <span style={{fontFamily:"'Playfair Display',serif",fontSize:"1.5rem",fontWeight:700,color:"var(--terracotta)",letterSpacing:"-0.02em"}}>
            $350 <span style={{fontSize:".74rem",color:"var(--t3)",fontFamily:"'Jost',sans-serif",fontWeight:400}}>adoption fee</span>
          </span>
          {dog.createdAt && <span style={{fontSize:".69rem",color:"var(--t3)"}}>{new Date(dog.createdAt).toLocaleDateString()}</span>}
        </div>
        {admin
          ? <div style={{display:"flex",gap:8}}>
              <Btn v="ghost" small onClick={()=>onEdit(dog)} sx={{flex:1}}>✏️ Edit</Btn>
              <Btn v="danger" small onClick={async()=>{if(!confirm(`Remove ${dog.name}?`))return;await onDelete(dog.id)}}>🗑️</Btn>
            </div>
          : dog.status==="adopted"
            ? <div style={{textAlign:"center",padding:"10px",borderRadius:11,background:"rgba(80,140,80,.08)",color:"#2d7a2d",fontWeight:600,fontSize:".88rem"}}>💛 Already in a loving home</div>
            : <Btn full onClick={()=>onAdopt(dog)}>Adopt {dog.name} 🐾</Btn>
        }
      </div>
    </div>
  );
}

function Tag({ children }) {
  return <span style={{background:"rgba(196,121,58,.1)",color:"var(--terracotta)",borderRadius:20,padding:"3px 11px",fontSize:".72rem",fontWeight:600,border:"1px solid rgba(196,121,58,.15)"}}>{children}</span>;
}

function SkDog() {
  return (
    <div style={{background:"#fff",borderRadius:20,overflow:"hidden",border:"1px solid rgba(196,121,58,.1)"}}>
      <div className="sk" style={{height:230}}/>
      <div style={{padding:"18px 20px"}}>
        <div className="sk" style={{height:16,width:"52%",marginBottom:10}}/>
        <div className="sk" style={{height:13,marginBottom:7}}/>
        <div className="sk" style={{height:13,width:"68%",marginBottom:18}}/>
        <div className="sk" style={{height:42,borderRadius:30}}/>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   DOGS SECTION
═══════════════════════════════════════════════════════════ */
function DogsSection({ dogs, loading, onAdopt, admin, onDelete, onEdit }) {
  const [flt, setFlt] = useState("all");
  const shown = dogs.filter(d => {
    if(flt==="avail") return d.status!=="adopted";
    if(flt==="f") return d.gender==="Female"&&d.status!=="adopted";
    if(flt==="m") return d.gender==="Male"&&d.status!=="adopted";
    if(flt==="ft") return d.featured;
    return true;
  });

  return (
    <section id="dogs" className="sec-pad" style={{padding:"88px 5vw",background:"var(--ivory2)"}}>
      {/* Decorative top border */}
      <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:48}}>
        <div style={{flex:1,height:1,background:"linear-gradient(90deg,transparent,rgba(196,121,58,.25))"}}/>
        <span style={{fontFamily:"'Playfair Display',serif",fontSize:"1.1rem",color:"var(--sand)",letterSpacing:".1em"}}>✦</span>
        <div style={{flex:1,height:1,background:"linear-gradient(90deg,rgba(196,121,58,.25),transparent)"}}/>
      </div>

      <div style={{textAlign:"center",marginBottom:48}}>
        <p className="sr" style={{fontSize:".72rem",letterSpacing:".18em",textTransform:"uppercase",color:"var(--warm)",fontWeight:700,marginBottom:10}}>READY FOR ADOPTION</p>
        <h2 className="sr serif sec-h" data-d={80} style={{fontFamily:"'Playfair Display',serif",
          fontSize:"clamp(2.2rem,5vw,3.5rem)",fontWeight:900,color:"var(--deep)",marginBottom:14,letterSpacing:"-0.02em"}}>
          Our Lovely Yorkies
        </h2>
        <p className="sr" data-d={130} style={{color:"var(--t2)",maxWidth:460,margin:"0 auto 28px",fontWeight:400}}>
          Each dog is vet-checked, vaccinated, microchipped & comes with full legal ownership paperwork.
        </p>

        {/* Filter chips */}
        <div className="sr" data-d={175} style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          {[["all","All"],["avail","Available"],["f","♀️ Girls"],["m","♂️ Boys"],["ft","⭐ Featured"]].map(([k,l]) => (
            <button key={k} onClick={()=>setFlt(k)} style={{
              padding:"7px 18px",borderRadius:50,border:`1.5px solid ${flt===k?"var(--warm)":"rgba(196,121,58,.22)"}`,
              background:flt===k?"linear-gradient(135deg,#b86830,#e8955a)":"rgba(250,246,240,.8)",
              color:flt===k?"#fff":"var(--t2)",cursor:"pointer",fontSize:".83rem",fontWeight:600,
              transition:"all .2s",boxShadow:flt===k?"0 3px 14px rgba(196,121,58,.3)":"none",
            }}>{l}</button>
          ))}
        </div>
      </div>

      {loading
        ? <div className="auto-cards">{[1,2,3].map(i=><SkDog key={i}/>)}</div>
        : shown.length===0
          ? <div style={{textAlign:"center",padding:"56px 0",color:"var(--t3)"}}>
              <div style={{fontSize:"3.5rem",marginBottom:14,animation:"float 3s ease-in-out infinite"}}>🐾</div>
              <p style={{fontSize:"1.05rem"}}>{dogs.length===0?"No Yorkies listed yet — check back soon!":"No dogs match this filter."}</p>
            </div>
          : <div className="auto-cards">
              {shown.map((d: any, i: any) => <DogCard key={d.id} dog={d} onAdopt={onAdopt} admin={admin} onDelete={onDelete} onEdit={onEdit} delay={i*70}/>)}
            </div>
      }
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   ADOPT MODAL (with real backend)
═══════════════════════════════════════════════════════════ */
function AdoptModal({ dog, onClose, onSubmit }) {
  const [f, setF] = useState({firstName:"",lastName:"",email:"",phone:"",location:"",timeline:"1-2 weeks",living:"",experience:"",message:""});
  const [errs, setErrs] = useState<any>({});
  const [step, setStep] = useState(1);
  const [res, setRes] = useState(null);
  const s = (k: string) => (v: any) => setF((x: any) => ({...x,[k]:v}));

  const validate = () => {
    const e: any = {};
    if(!f.firstName.trim())e.firstName="Required";
    if(!f.lastName.trim())e.lastName="Required";
    if(!f.email||!/\S+@\S+\.\S+/.test(f.email))e.email="Valid email required";
    if(!f.phone.trim())e.phone="Required";
    if(!f.location.trim())e.location="Required";
    if(!f.message.trim())e.message="Required";
    setErrs(e); return !Object.keys(e).length;
  };

  const submit = async () => {
    if(!validate()) return;
    setStep(2);
    try { const r=await onSubmit({...f,dogId:dog.id,dogName:dog.name}); setRes(r); setStep(3); }
    catch { setStep(1); }
  };

  return (
    <Modal open title={`Adopt ${dog?.name}`} sub="Complete your application — we'll respond within 24–48 hours" onClose={onClose}>
      {step===2 && (
        <div style={{textAlign:"center",padding:"32px 0"}}>
          <Spinner size={44} color="var(--warm)"/>
          <p style={{marginTop:18,color:"var(--t2)"}}>Saving your application & preparing email…</p>
        </div>
      )}
      {step===3 && (
        <div style={{textAlign:"center",padding:"16px 0 24px"}}>
          <div style={{fontSize:"3.5rem",marginBottom:14,animation:"popIn .5s ease"}}>🎉</div>
          <h3 className="serif" style={{color:"var(--terracotta)",fontSize:"1.65rem",marginBottom:10,fontWeight:700}}>Application Submitted!</h3>
          <p style={{color:"var(--t2)",lineHeight:1.8,marginBottom:16}}>
            Your application for <strong style={{color:"var(--warm)"}}>{dog?.name}</strong> has been received.
          </p>

          {/* Email status cards */}
          <div className="ai-sc-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18,textAlign:"left"}}>
            <div style={{background:"rgba(80,140,80,.08)",border:"1px solid rgba(80,140,80,.2)",borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:"1.2rem",marginBottom:5}}>📧</div>
              <div style={{fontWeight:800,color:"#2d7a2d",fontSize:".84rem",marginBottom:3}}>Owner Notified</div>
              <p style={{fontSize:".78rem",color:"var(--t2)",lineHeight:1.5}}>Janet has been emailed at <strong>janethooks85@gmail.com</strong> with your full application.</p>
            </div>
            <div style={{background:"rgba(80,140,80,.08)",border:"1px solid rgba(80,140,80,.2)",borderRadius:12,padding:"12px 14px"}}>
              <div style={{fontSize:"1.2rem",marginBottom:5}}>✉️</div>
              <div style={{fontWeight:800,color:"#2d7a2d",fontSize:".84rem",marginBottom:3}}>Confirmation Sent</div>
              <p style={{fontSize:".78rem",color:"var(--t2)",lineHeight:1.5}}>A confirmation email has been sent to <strong>{dog && (res )?.email}</strong>.</p>
            </div>
          </div>

          <div style={{background:"rgba(196,121,58,.07)",border:"1px solid rgba(196,121,58,.18)",borderRadius:14,padding:"14px 18px",marginBottom:20,textAlign:"left"}}>
            <p style={{fontSize:".8rem",color:"var(--warm)",fontWeight:800,marginBottom:5}}>⚡ AI Review Running</p>
            <p style={{fontSize:".81rem",color:"var(--t2)",lineHeight:1.65}}>Our AI assistant is analyzing your application now. Janet will see a full suitability report in the owner dashboard alongside your application.</p>
          </div>

          <p style={{color:"var(--t3)",fontSize:".83rem",marginBottom:20}}>
            Application ID: <code style={{color:"var(--warm)",background:"rgba(196,121,58,.1)",padding:"2px 8px",borderRadius:6}}>{(res as any)?.id?.slice(0,8).toUpperCase()}</code>
          </p>
          <p style={{color:"var(--t3)",fontSize:".82rem",marginBottom:22}}>We'll be in touch within <strong style={{color:"var(--terracotta)"}}>24–48 hours</strong>.</p>
          <Btn v="outline" onClick={onClose}>Close</Btn>
        </div>
      )}
      {step===1 && (
        <>
          <div className="cols-2">
            <Field label="First Name" id="a1" value={f.firstName} onChange={s("firstName")} required placeholder="Jane" err={errs.firstName}/>
            <Field label="Last Name" id="a2" value={f.lastName} onChange={s("lastName")} required placeholder="Doe" err={errs.lastName}/>
          </div>
          <Field label="Email" id="a3" type="email" value={f.email} onChange={s("email")} required placeholder="jane@email.com" err={errs.email}/>
          <Field label="Phone" id="a4" type="tel" value={f.phone} onChange={s("phone")} required placeholder="(555) 000-0000" err={errs.phone}/>
          <Field label="Your Location" id="a5" value={f.location} onChange={s("location")} required placeholder="City, State / Country" err={errs.location} hint="Helps us understand proximity and local pet regulations."/>
          <Field label="How soon do you want to adopt?" id="a6" value={f.timeline} onChange={s("timeline")} opts={[
            {v:"ASAP",l:"As soon as possible"},{v:"1-2 weeks",l:"Within 1–2 weeks"},
            {v:"1 month",l:"Within 1 month"},{v:"2-3 months",l:"2–3 months"},{v:"flexible",l:"I'm flexible / just exploring"},
          ]}/>
          <Field label="Living Situation" id="a7" value={f.living} onChange={s("living")} opts={[
            {v:"",l:"— Select —"},{v:"house",l:"🏠 House with yard"},{v:"house-no-yard",l:"🏠 House without yard"},
            {v:"apartment",l:"🏢 Apartment / Condo"},{v:"other",l:"Other"},
          ]}/>
          <Field label="Prior Dog Experience" id="a8" value={f.experience} onChange={s("experience")} opts={[
            {v:"",l:"— Select —"},{v:"none",l:"🐣 First-time owner"},{v:"some",l:"🐾 Some experience"},
            {v:"experienced",l:"⭐ Experienced owner"},{v:"yorkie",l:"🏆 Have owned Yorkies before"},
          ]}/>
          <Field label="Tell us about you & your home" id="a9" value={f.message} onChange={s("message")} required rows={4}
            placeholder="Why do you want a Yorkie? Your home, lifestyle, family…" err={errs.message}/>
          <Btn full onClick={submit}>Submit Application — $350 Fee</Btn>
          <p style={{fontSize:".75rem",color:"var(--t3)",textAlign:"center",marginTop:9}}>Application saved to our system & emailed to the owner. Fee collected upon approval.</p>
        </>
      )}
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   ABOUT
═══════════════════════════════════════════════════════════ */
function About() {
  const docs=[
    {icon:"📋",title:"Adoption Contract",desc:"A formal agreement covering responsibilities, care standards, and return policy."},
    {icon:"🏥",title:"Health Certificate",desc:"Vet-issued document with vaccination history, microchip number, and health clearance."},
    {icon:"🔄",title:"Transfer of Ownership",desc:"Official document that legally transfers the dog into your name."},
    {icon:"📌",title:"Microchip Registration",desc:"We transfer microchip records to your contact info in national databases."},
    {icon:"💉",title:"Vaccination Records",desc:"Complete vaccination history with dates and licensed vet signatures."},
    {icon:"📖",title:"Yorkie Care Guide",desc:"First-week guide covering feeding, grooming, training, and bonding."},
  ];
  return (
    <section id="about" className="sec-pad" style={{padding:"88px 5vw",background:"var(--ivory)"}}>
      {/* Two col */}
      <div className="cols-2 tablet-1" style={{gap:"clamp(32px,6vw,72px)",alignItems:"center",marginBottom:80}}>
        <div className="sr-l">
          <p style={{fontSize:".72rem",letterSpacing:".18em",textTransform:"uppercase",color:"var(--warm)",fontWeight:700,marginBottom:10}}>WHO WE ARE</p>
          <h2 className="serif" style={{fontFamily:"'Playfair Display',serif",
            fontSize:"clamp(2.1rem,5vw,3.2rem)",fontWeight:900,color:"var(--deep)",
            marginBottom:20,lineHeight:1.1,letterSpacing:"-0.02em"}}>
            Dedicated to Every<br/><em style={{fontStyle:"italic",color:"var(--terracotta)"}}>Tiny Life</em>
          </h2>
          <p style={{color:"var(--t2)",lineHeight:1.85,marginBottom:18,fontWeight:400}}>
            Janet Companion Yorkie Rescue is a passionate, family-run rescue dedicated solely to Yorkshire Terriers. Every dog receives full veterinary care, loving socialization, and a thorough screening of their future home.
          </p>
          <p style={{color:"var(--t2)",lineHeight:1.85,marginBottom:30,fontWeight:400}}>
            We provide <strong style={{color:"var(--terracotta)"}}>complete legal documentation</strong> with every adoption — including an official transfer of ownership — so you and your Yorkie can start your journey with complete confidence.
          </p>
          {[["🏥","Full Vet Care","Every dog is vaccinated, microchipped & cleared by our licensed vet."],
            ["🏠","Home Screening","We carefully evaluate every applicant to ensure the perfect match."],
            ["💛","Lifetime Support","We stay in touch long after your Yorkie comes home."]].map(([ico,ttl,dsc])=>(
            <div key={ttl} style={{display:"flex",gap:14,marginBottom:20,alignItems:"flex-start"}}>
              <div style={{width:44,height:44,borderRadius:12,background:"rgba(196,121,58,.1)",border:"1px solid rgba(196,121,58,.18)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.2rem",flexShrink:0}}>{ico}</div>
              <div>
                <div style={{fontWeight:700,color:"var(--deep)",marginBottom:2,fontSize:".95rem"}}>{ttl}</div>
                <p style={{fontSize:".87rem",color:"var(--t2)",lineHeight:1.6}}>{dsc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Visual */}
        <div className="sr-r" style={{position:"relative"}}>
          <div style={{borderRadius:28,overflow:"hidden",minHeight:220,
            background:"linear-gradient(135deg,var(--ivory3),var(--sand2))",
            display:"flex",alignItems:"center",justifyContent:"center",fontSize:"8rem",
            border:"2px solid rgba(196,121,58,.15)",
            boxShadow:"0 20px 60px rgba(44,24,16,.15), inset 0 1px 0 rgba(255,255,255,.8)"}}><img
            src="https://cdn.greenfieldpuppies.com/wp-content/uploads/2025/03/three-yorkie-puppies-sitting-in-grass-600x600.jpeg" alt="Yorkie dog"
            style={{width:"100%",height:"100%",objectFit:"cover",borderRadius:26}}
          />
        </div>
          {/* Decorative badge */}
          <div style={{position:"absolute",bottom:-16,right:-16,
            background:"linear-gradient(135deg,#8b3a0f,#c4793a)",
            borderRadius:20,padding:"14px 20px",boxShadow:"0 8px 28px rgba(139,58,15,.35)",
            textAlign:"center"}}>
            <div style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",fontWeight:900,color:"#fff",lineHeight:1}}>$350</div>
            <div style={{fontSize:".68rem",color:"rgba(255,255,255,.75)",letterSpacing:".09em",textTransform:"uppercase",marginTop:3}}>Adoption Fee</div>
          </div>
        </div>
      </div>

      {/* Paperwork grid */}
      <div style={{textAlign:"center",marginBottom:40}}>
        <p className="sr" style={{fontSize:".72rem",letterSpacing:".18em",textTransform:"uppercase",color:"var(--warm)",fontWeight:700,marginBottom:10}}>COMPLETE DOCUMENTATION</p>
        <h3 className="sr serif" data-d={80} style={{fontFamily:"'Playfair Display',serif",
          fontSize:"clamp(1.9rem,4vw,2.8rem)",fontWeight:900,color:"var(--deep)",marginBottom:12,letterSpacing:"-0.02em"}}>
          Every Adoption Includes
        </h3>
        <p className="sr" data-d={130} style={{color:"var(--t2)",maxWidth:460,margin:"0 auto"}}>
          Full transparency is our promise — every family receives all documents they need.
        </p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:18}}>
        {docs.map((d: any, i: any) =>(
          <div key={d.title} className="sr-z" data-d={i*65}
            style={{background:"#fff",border:"1px solid rgba(196,121,58,.12)",borderRadius:18,padding:"22px 20px",
              transition:"all .24s",cursor:"default"}}
            onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(196,121,58,.35)";e.currentTarget.style.transform="translateY(-4px)";e.currentTarget.style.boxShadow="0 12px 32px rgba(44,24,16,.12)"}}
            onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(196,121,58,.12)";e.currentTarget.style.transform="none";e.currentTarget.style.boxShadow="none"}}>
            <div style={{fontSize:"1.9rem",marginBottom:10}}>{d.icon}</div>
            <div style={{fontWeight:700,color:"var(--deep)",marginBottom:5,fontSize:".95rem"}}>{d.title}</div>
            <p style={{fontSize:".87rem",color:"var(--t2)",lineHeight:1.65}}>{d.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   GALLERY
═══════════════════════════════════════════════════════════ */

// Reliable Yorkie fallback images if a URL fails to load
const YORKIE_FALLBACKS = [
  "https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=600&q=80",
  "https://images.unsplash.com/photo-1576201836106-db1758fd1c97?w=600&q=80",
  "https://images.unsplash.com/photo-1574158622682-e40e69881006?w=600&q=80",
  "https://images.unsplash.com/photo-1583511655826-05700d52f4d9?w=600&q=80",
];

function GalleryImg({ src, alt, style }) {
  const [imgSrc, setImgSrc] = useState(src);
  const [tries, setTries] = useState(0);
  return (
    <img
      src={imgSrc}
      alt={alt || "Yorkie dog"}
      style={style}
      onError={() => {
        const next = YORKIE_FALLBACKS[tries % YORKIE_FALLBACKS.length];
        if (imgSrc !== next) { setImgSrc(next); setTries(t => t + 1); }
      }}
    />
  );
}

function Gallery({ admin, toast }) {
  const [items, setItems]   = useState<any[]>([]);
  const [loading, setLoad]  = useState(true);
  const [addOpen, setAdd]   = useState(false);
  const [lb, setLb]         = useState<any>(null);
  const [lbIdx, setLbIdx]   = useState(0);

  const load = useCallback(async () => { setLoad(true); setItems(await API.getGal()); setLoad(false); }, []);
  useEffect(() => { load(); }, [load]);

  const openLightbox = (item, idx: number) => { setLb(item); setLbIdx(idx); };
  const prevLb = () => { const i = (lbIdx - 1 + items.length) % items.length; setLb(items[i]); setLbIdx(i); };
  const nextLb = () => { const i = (lbIdx + 1) % items.length; setLb(items[i]); setLbIdx(i); };

  const resetGallery = useCallback(() => {
    if (!confirm("Reset gallery to default Yorkie photos?")) return;
    localStorage.removeItem("jcyr5_gal");
    load();
    toast("Gallery reset to default photos! 📸");
  }, [load, toast]);

  return (
    <section id="gallery" className="sec-pad" style={{ padding:"88px 5vw", background:"var(--ivory2)" }}>

      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", marginBottom:48, flexWrap:"wrap", gap:18 }}>
        <div>
          <p className="sr" style={{ fontSize:".72rem", letterSpacing:".18em", textTransform:"uppercase", color:"var(--warm)", fontWeight:700, marginBottom:10 }}>OUR MOMENTS</p>
          <h2 className="sr serif" data-d={80} style={{ fontFamily:"'Playfair Display',serif",
            fontSize:"clamp(2.2rem,5vw,3.3rem)", fontWeight:900, color:"var(--deep)", letterSpacing:"-0.02em" }}>
            Photo & Video Gallery
          </h2>
          {!loading && items.length > 0 && (
            <p className="sr" data-d={130} style={{ color:"var(--t3)", fontSize:".85rem", marginTop:8 }}>
              {items.length} photo{items.length !== 1 ? "s" : ""} · Click any image to enlarge
            </p>
          )}
        </div>
        <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
          {admin && (
            <>
              <Btn onClick={() => setAdd(true)}>➕ Add Photo / Video</Btn>
              <Btn v="ghost" small onClick={resetGallery}>↺ Reset</Btn>
            </>
          )}
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="masonry-grid">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="sk" style={{ height:160+i*28, marginBottom:14, borderRadius:16, breakInside:"avoid" }} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div style={{ textAlign:"center", padding:"56px 0", color:"var(--t3)" }}>
          <div style={{ fontSize:"3.5rem", marginBottom:14, animation:"float 3s ease-in-out infinite" }}>📸</div>
          <p style={{ fontSize:"1.05rem" }}>No gallery items yet.{admin ? " Add the first one!" : ""}</p>
        </div>
      ) : (
        <div className="masonry-grid">
          {items.map((item, i) => (
            <div key={item.id} className="sr-z" data-d={Math.min(i * 50, 400)}
              style={{ breakInside:"avoid", marginBottom:14, borderRadius:18, overflow:"hidden",
                position:"relative", cursor:"pointer",
                border:"1px solid rgba(196,121,58,.12)",
                transition:"all .28s cubic-bezier(.34,1.4,.64,1)",
                boxShadow:"0 2px 12px rgba(44,24,16,.08)" }}
              onClick={() => openLightbox(item, i)}
              onMouseEnter={e => {
                e.currentTarget.style.transform = "scale(1.03) translateY(-3px)";
                e.currentTarget.style.borderColor = "rgba(196,121,58,.42)";
                e.currentTarget.style.boxShadow = "0 12px 36px rgba(44,24,16,.18)";
              }}
              onMouseLeave={e => {
                e.currentTarget.style.transform = "none";
                e.currentTarget.style.borderColor = "rgba(196,121,58,.12)";
                e.currentTarget.style.boxShadow = "0 2px 12px rgba(44,24,16,.08)";
              }}>

              {item.type === "video"
                ? <video src={item.src} muted style={{ width:"100%", display:"block" }} />
                : <GalleryImg
                    src={item.src}
                    alt={item.caption || `Yorkie photo ${i + 1}`}
                    style={{ width:"100%", display:"block", minHeight:120, objectFit:"cover" }}
                  />
              }

              {/* Hover overlay with caption + actions */}
              <div style={{ position:"absolute", inset:0,
                background:"linear-gradient(to top, rgba(44,24,16,.78) 0%, rgba(44,24,16,.1) 45%, transparent 65%)",
                display:"flex", flexDirection:"column", justifyContent:"flex-end",
                padding:"20px 12px 13px", opacity:0, transition:"opacity .25s" }}
                onMouseEnter={e => e.currentTarget.style.opacity = "1"}
                onMouseLeave={e => e.currentTarget.style.opacity = "0"}>
                {item.caption && (
                  <span style={{ fontSize:".8rem", color:"rgba(250,246,240,.92)", fontWeight:600, lineHeight:1.45, marginBottom: admin ? 8 : 0 }}>
                    {item.caption}
                  </span>
                )}
                {admin && (
                  <button onClick={e => {
                    e.stopPropagation();
                    API.deleteMedia(item.id).then(() => { setItems((g: any[]) => g.filter((x: any) => x.id !== item.id)); toast("Removed from gallery."); });
                  }} style={{ alignSelf:"flex-end", background:"rgba(160,50,50,.85)", border:"none", borderRadius:"50%",
                    width:28, height:28, color:"#fff", cursor:"pointer", fontSize:".8rem",
                    display:"flex", alignItems:"center", justifyContent:"center" }}>🗑️</button>
                )}
              </div>

              {/* Always-visible caption strip at bottom */}
              {item.caption && (
                <div style={{ position:"absolute", bottom:0, left:0, right:0,
                  background:"linear-gradient(to top, rgba(44,24,16,.7), transparent)",
                  padding:"22px 12px 10px" }}>
                  <span style={{ fontSize:".77rem", color:"rgba(250,246,240,.82)", fontWeight:600 }}>{item.caption}</span>
                </div>
              )}

              {/* Video badge */}
              {item.type === "video" && (
                <div style={{ position:"absolute", top:10, right:10,
                  background:"rgba(44,24,16,.7)", borderRadius:20, padding:"3px 10px",
                  fontSize:".68rem", color:"rgba(250,246,240,.9)", fontWeight:700 }}>▶ VIDEO</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox with prev/next navigation */}
      {lb && (
        <div onClick={() => setLb(null)}
          style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(44,24,16,.93)",
            backdropFilter:"blur(12px)", display:"flex", alignItems:"center", justifyContent:"center",
            padding:16, cursor:"pointer" }}>

          {/* Prev button */}
          {items.length > 1 && (
            <button onClick={e => { e.stopPropagation(); prevLb(); }}
              style={{ position:"absolute", left:16, top:"50%", transform:"translateY(-50%)", zIndex:1,
                background:"rgba(250,246,240,.12)", border:"1px solid rgba(250,246,240,.2)",
                borderRadius:"50%", width:46, height:46, color:"rgba(250,246,240,.85)",
                cursor:"pointer", fontSize:"1.3rem", display:"flex", alignItems:"center", justifyContent:"center" }}>‹</button>
          )}

          <div style={{ maxWidth:"90vw", maxHeight:"90vh", position:"relative", cursor:"default" }}
            onClick={e => e.stopPropagation()}>
            {lb.type === "video"
              ? <video src={lb.src} controls autoPlay style={{ maxWidth:"100%", maxHeight:"84vh", borderRadius:16 }} />
              : <GalleryImg src={lb.src} alt={lb.caption || "Yorkie"} style={{ maxWidth:"100%", maxHeight:"84vh", borderRadius:16, objectFit:"contain", display:"block" }} />
            }
            {lb.caption && (
              <p style={{ textAlign:"center", color:"rgba(250,246,240,.65)", marginTop:12, fontSize:".88rem" }}>{lb.caption}</p>
            )}
            <p style={{ textAlign:"center", color:"rgba(250,246,240,.3)", marginTop:4, fontSize:".73rem" }}>
              {lbIdx + 1} / {items.length}
            </p>
            <button onClick={() => setLb(null)} style={{ position:"absolute", top:-12, right:-12,
              background:"var(--warm)", border:"none", borderRadius:"50%",
              width:34, height:34, color:"#fff", cursor:"pointer", fontSize:".95rem" }}>✕</button>
          </div>

          {/* Next button */}
          {items.length > 1 && (
            <button onClick={e => { e.stopPropagation(); nextLb(); }}
              style={{ position:"absolute", right:16, top:"50%", transform:"translateY(-50%)", zIndex:1,
                background:"rgba(250,246,240,.12)", border:"1px solid rgba(250,246,240,.2)",
                borderRadius:"50%", width:46, height:46, color:"rgba(250,246,240,.85)",
                cursor:"pointer", fontSize:"1.3rem", display:"flex", alignItems:"center", justifyContent:"center" }}>›</button>
          )}
        </div>
      )}

      {addOpen && (
        <AddMediaModal onClose={() => setAdd(false)} onSave={async item => {
          const m = await API.addMedia(item);
          setItems((g: any[]) => [m, ...g]);
          setAdd(false);
          toast("Added to gallery! 📸");
        }} />
      )}
    </section>
  );
}

function AddMediaModal({ onClose, onSave }) {
  const [src,setSrc]=useState("");const [type,setType]=useState("image");
  const [cap,setCap]=useState("");const [mode,setMode]=useState("file");const [L,setL]=useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const hFile = (e: any) => {const f=e.target.files[0];if(!f)return;const v=f.type.startsWith("video/");setType(v?"video":"image");const r=new FileReader();r.onload=(ev)=>setSrc((ev.target as any).result as string);r.readAsDataURL(f);};
  return (
    <Modal open title="Add to Gallery" sub="Upload or link a photo / video" onClose={onClose}>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        {[["file","📁 Upload"],["url","🔗 URL"]].map(([k,l])=>(
          <button key={k} onClick={()=>setMode(k)} style={{flex:1,padding:"8px",borderRadius:11,cursor:"pointer",
            background:mode===k?"rgba(196,121,58,.1)":"transparent",
            border:`1.5px solid ${mode===k?"var(--warm)":"rgba(196,121,58,.22)"}`,
            color:mode===k?"var(--terracotta)":"var(--t3)",fontWeight:600,fontSize:".85rem"}}>{l}</button>
        ))}
      </div>
      {mode==="file"
        ?<>
           <input type="file" ref={ref} accept="image/*,video/*" onChange={hFile} style={{display:"none"}}/>
           <div onClick={()=>ref.current?.click()} style={{border:"2px dashed rgba(196,121,58,.25)",borderRadius:14,
             padding:"26px 18px",textAlign:"center",cursor:"pointer",marginBottom:14,
             background:"rgba(196,121,58,.03)",transition:"border-color .2s"}}
             onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(196,121,58,.5)"}
             onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(196,121,58,.25)"}>
             {src?type==="video"?<video src={src} style={{maxHeight:130,borderRadius:9}} controls/>:<img src={src} style={{maxHeight:130,borderRadius:9,objectFit:"cover"}}/>
               :<><div style={{fontSize:"2.2rem",marginBottom:8}}>📷</div><p style={{color:"var(--t3)",fontSize:".88rem"}}>Click to upload photo or video</p></>}
           </div>
         </>
        :<Field value={src} onChange={v=>{setSrc(v);setType("image")}} placeholder="https://…"/>
      }
      <Field label="Caption (optional)" value={cap} onChange={setCap} placeholder="Bella enjoying a sunny afternoon…"/>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn v="ivory" onClick={onClose}>Cancel</Btn>
        <Btn disabled={!src} loading={L} onClick={async()=>{if(!src)return;setL(true);await onSave({src,type,caption:cap});setL(false);}}>Add to Gallery</Btn>
      </div>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   CONTACT / CTA
═══════════════════════════════════════════════════════════ */
function Contact() {
  return (
    <section id="contact" className="sec-pad" style={{
      padding:"88px 5vw",
      background:"linear-gradient(160deg,var(--deep) 0%,var(--deep2) 100%)",
      position:"relative",overflow:"hidden",
    }}>
      {/* Background decoration */}
      <div style={{position:"absolute",top:"-20%",right:"-10%",width:"50vw",height:"50vw",
        borderRadius:"50%",background:"rgba(196,121,58,.07)",pointerEvents:"none"}}/>
      <div style={{position:"absolute",bottom:"-15%",left:"-5%",width:"35vw",height:"35vw",
        borderRadius:"50%",background:"rgba(196,121,58,.05)",pointerEvents:"none"}}/>

      <div style={{maxWidth:780,margin:"0 auto",textAlign:"center",position:"relative"}}>
        <p className="sr" style={{fontSize:".72rem",letterSpacing:".18em",textTransform:"uppercase",color:"var(--warm2)",fontWeight:700,marginBottom:10}}>READY TO ADOPT?</p>
        <h2 className="sr serif" data-d={80} style={{fontFamily:"'Playfair Display',serif",
          fontSize:"clamp(2.2rem,5vw,3.5rem)",fontWeight:900,color:"var(--ivory)",
          marginBottom:18,lineHeight:1.1,letterSpacing:"-0.02em"}}>
          Start Your Adoption Journey
        </h2>
        <p className="sr" data-d={130} style={{color:"rgba(250,246,240,.6)",lineHeight:1.88,maxWidth:540,margin:"0 auto 14px"}}>
          Ready to bring a Yorkie home? Click the button below and your email app will open with a pre-filled message sent directly to Janet. She will get back to you within 24–48 hours.
        </p>
        <p className="sr" data-d={175} style={{color:"rgba(232,149,90,.7)",fontSize:".9rem",marginBottom:44,maxWidth:480,margin:"0 auto 44px"}}>
          📧 Your email goes directly to janethooks85@gmail.com — no forms, no waiting.
        </p>

        {/* CTA card */}
        <div className="sr-z" data-d={240} style={{
          background:"rgba(250,246,240,.06)",border:"1px solid rgba(196,121,58,.25)",
          borderRadius:28,padding:"clamp(28px,5vw,52px) clamp(20px,5vw,48px)",
          backdropFilter:"blur(4px)",position:"relative",overflow:"hidden",
        }}>
          <div style={{position:"absolute",inset:0,background:"linear-gradient(135deg,rgba(196,121,58,.08),rgba(196,121,58,.02))",pointerEvents:"none"}}/>
          <div style={{fontSize:"3.2rem",marginBottom:18,animation:"float 3s ease-in-out infinite",position:"relative"}}>🐾</div>
          <h3 className="serif" style={{fontFamily:"'Playfair Display',serif",fontSize:"1.85rem",color:"var(--ivory)",fontWeight:700,marginBottom:10,position:"relative"}}>
            Contact Janet Directly
          </h3>
          <p style={{color:"rgba(250,246,240,.55)",marginBottom:30,lineHeight:1.75,maxWidth:440,margin:"0 auto 30px",position:"relative"}}>
            One click opens your email app with everything pre-filled. Janet personally reviews every inquiry and responds within 24–48 hours.
          </p>
          <Btn onClick={()=>{
            const subject = encodeURIComponent("🐾 Adoption Inquiry — Janet Companion Yorkie Rescue");
            const body = encodeURIComponent(`Hi Janet!\n\nI am interested in adopting a Yorkie from Janet Companion Yorkie Rescue.\n\nMy name: \nPhone: \nLocation: \nTimeline: \nLiving situation: \nDog experience: \n\nMessage:\n\n`);
            window.location.href = `mailto:${OWNER_EMAIL}?subject=${subject}&body=${body}`;
          }} v="primary" sx={{fontSize:"1.05rem",padding:"15px 44px",position:"relative"}}>
            Email Us to Adopt 🐾
          </Btn>
          <p style={{fontSize:".77rem",color:"rgba(250,246,240,.3)",marginTop:14,position:"relative"}}>
            Opens your email app with a pre-filled message directly to janethooks85@gmail.com
          </p>
        </div>

        {/* Contact info */}
        <div className="sr" data-d={330} style={{display:"flex",gap:16,justifyContent:"center",marginTop:44,flexWrap:"wrap"}}>
          {[["📧","Email",OWNER_EMAIL,`mailto:${OWNER_EMAIL}`],["💰","Adoption Fee","$350 per dog",null],["⏰","Response","Within 24–48 hrs",null]].map(([ico,lbl,val,href])=>(
            <div key={lbl} style={{display:"flex",gap:10,alignItems:"center",
              background:"rgba(250,246,240,.06)",border:"1px solid rgba(196,121,58,.2)",borderRadius:15,padding:"12px 18px"}}>
              <span style={{fontSize:"1.2rem"}}>{ico}</span>
              <div>
                <div style={{fontSize:".69rem",color:"rgba(250,246,240,.35)",textTransform:"uppercase",letterSpacing:".09em",fontWeight:700}}>{lbl}</div>
                {href?<a href={href} style={{color:"var(--warm2)",fontSize:".87rem",textDecoration:"none"}}>{val}</a>
                  :<div style={{color:"rgba(250,246,240,.7)",fontSize:".87rem"}}>{val}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ═══════════════════════════════════════════════════════════
   ADD / EDIT DOG MODALS
═══════════════════════════════════════════════════════════ */
function AddDogModal({ onClose, onSave }) {
  const [f,setF]=useState({name:"",age:"",gender:"Female",weight:"",desc:"",mediaType:"image",mediaSrc:"",featured:false});
  const [mode,setMode]=useState("file");const [L,setL]=useState(false);const [err,setErr]=useState<any>({});
  const ref = useRef<HTMLInputElement>(null);
  const s = (k: string) => (v: any) => setF((x: any) => ({...x,[k]:v}));
  const hFile = (e: any) => {const file=e.target.files[0];if(!file)return;const v=file.type.startsWith("video/");const r=new FileReader();r.onload=(ev)=>setF((x)=>({...x,mediaSrc:(ev.target as any).result as string,mediaType:v?"video":"image"}));r.readAsDataURL(file);};
  return (
    <Modal open title="Add New Yorkie" sub="Create a new adoption listing" onClose={onClose} wide>
      <div className="cols-2">
        <Field label="Name" value={f.name} onChange={s("name")} required placeholder="e.g. Bella" err={err.name}/>
        <Field label="Age" value={f.age} onChange={s("age")} placeholder="e.g. 2 years"/>
        <Field label="Gender" value={f.gender} onChange={s("gender")} opts={[{v:"Female",l:"♀️ Female"},{v:"Male",l:"♂️ Male"}]}/>
        <Field label="Weight" value={f.weight} onChange={s("weight")} placeholder="e.g. 5 lbs"/>
      </div>
      <Field label="Description" value={f.desc} onChange={s("desc")} rows={3} placeholder="Personality, temperament, quirks…"/>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontWeight:600,fontSize:".79rem",color:"var(--terracotta)",marginBottom:7,letterSpacing:".06em",textTransform:"uppercase"}}>Media</label>
        <div style={{display:"flex",gap:8,marginBottom:11}}>
          {[["file","📁 Upload"],["url","🔗 URL"]].map(([k,l])=>(
            <button key={k} onClick={()=>setMode(k)} style={{padding:"7px 16px",borderRadius:20,cursor:"pointer",
              background:mode===k?"rgba(196,121,58,.1)":"transparent",
              border:`1.5px solid ${mode===k?"var(--warm)":"rgba(196,121,58,.2)"}`,
              color:mode===k?"var(--terracotta)":"var(--t3)",fontWeight:600,fontSize:".83rem"}}>{l}</button>
          ))}
        </div>
        {mode==="file"
          ?<>
             <input type="file" ref={ref} accept="image/*,video/*" onChange={hFile} style={{display:"none"}}/>
             <div onClick={()=>ref.current?.click()} style={{border:"2px dashed rgba(196,121,58,.22)",borderRadius:13,padding:"22px",textAlign:"center",cursor:"pointer",background:"rgba(196,121,58,.03)",transition:"border-color .2s"}}
               onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(196,121,58,.5)"}
               onMouseLeave={e=>e.currentTarget.style.borderColor="rgba(196,121,58,.22)"}>
               {f.mediaSrc?f.mediaType==="video"?<video src={f.mediaSrc} style={{maxHeight:120,borderRadius:8}} controls/>:<img src={f.mediaSrc} style={{maxHeight:120,borderRadius:8,objectFit:"cover"}}/>
                 :<><div style={{fontSize:"2rem",marginBottom:7}}>📷</div><p style={{color:"var(--t3)",fontSize:".87rem"}}>Click to upload photo or video</p></>}
             </div>
           </>
          :<Field value={f.mediaSrc} onChange={v=>setF(x=>({...x,mediaSrc:v,mediaType:"image"}))} placeholder="https://…"/>
        }
      </div>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:20}}>
        <input type="checkbox" id="aft" checked={f.featured} onChange={e=>s("featured")(e.target.checked)} style={{width:16,height:16,accentColor:"var(--warm)"}}/>
        <label htmlFor="aft" style={{color:"var(--deep)",fontWeight:600,fontSize:".88rem",cursor:"pointer"}}>⭐ Mark as Featured</label>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn v="ivory" onClick={onClose}>Cancel</Btn>
        <Btn loading={L} onClick={async()=>{if(!f.name.trim()){setErr({name:"Required"});return;}setL(true);await onSave(f);setL(false);}}>Add to Listings</Btn>
      </div>
    </Modal>
  );
}

function EditDogModal({ dog, onClose, onSave }) {
  const [f,setF]=useState({name:dog.name,age:dog.age||"",gender:dog.gender||"Female",weight:dog.weight||"",desc:dog.desc||"",status:dog.status||"available",featured:dog.featured||false});
  const [L,setL]=useState(false);const s=k=>v=>setF(x=>({...x,[k]:v}));
  return (
    <Modal open title={`Edit ${dog.name}`} onClose={onClose} wide>
      <div className="cols-2">
        <Field label="Name" value={f.name} onChange={s("name")} required/>
        <Field label="Age" value={f.age} onChange={s("age")} placeholder="e.g. 2 years"/>
        <Field label="Gender" value={f.gender} onChange={s("gender")} opts={[{v:"Female",l:"♀️ Female"},{v:"Male",l:"♂️ Male"}]}/>
        <Field label="Weight" value={f.weight} onChange={s("weight")}/>
      </div>
      <Field label="Description" value={f.desc} onChange={s("desc")} rows={3}/>
      <Field label="Status" value={f.status} onChange={s("status")} opts={[{v:"available",l:"✅ Available"},{v:"pending",l:"⏳ Pending"},{v:"adopted",l:"🏠 Adopted"}]}/>
      <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:20}}>
        <input type="checkbox" id="eft" checked={f.featured} onChange={e=>s("featured")(e.target.checked)} style={{width:16,height:16,accentColor:"var(--warm)"}}/>
        <label htmlFor="eft" style={{color:"var(--deep)",fontWeight:600,fontSize:".88rem",cursor:"pointer"}}>⭐ Featured</label>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <Btn v="ivory" onClick={onClose}>Cancel</Btn>
        <Btn loading={L} onClick={async()=>{setL(true);await onSave(dog.id,f);setL(false);}}>Save Changes</Btn>
      </div>
    </Modal>
  );
}
/* ═══════════════════════════════════════════════════════════
   ADMIN DASHBOARD
═══════════════════════════════════════════════════════════ */
function AdminDash({ onClose, toast }) {
  const [tab,setTab]=useState("dogs");
  const [dogs,setDogs]=useState<any[]>([]);const [apps,setApps]=useState<any[]>([]);
  const [L,setL]=useState(true);const [addOpen,setAdd]=useState(false);const [editDog,setEdit]=useState(null);
  const [tick,setTick]=useState(0);

  const load=async()=>{setL(true);const[d,a]=await Promise.all([API.getDogs(),API.getApps()]);setDogs(d);setApps(a);setL(false);};
  useEffect(()=>{load();},[tick]);
  // Poll while AI loading
  useEffect(()=>{const h=apps.some((a: any) =>a.aiLoading);if(!h)return;const t=setTimeout(()=>setTick(x=>x+1),4000);return()=>clearTimeout(t);},[apps]);

  return (
    <div style={{background:"var(--ivory2)",minHeight:"100vh",padding:"28px 5vw"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:26,flexWrap:"wrap",gap:14}}>
        <div>
          <h2 className="serif" style={{fontFamily:"'Playfair Display',serif",color:"var(--terracotta)",fontSize:"2rem",fontWeight:900}}>🐾 Admin Dashboard</h2>
          <p style={{color:"var(--t3)",fontSize:".83rem"}}>Janet Companion Yorkie Rescue</p>
        </div>
        <Btn v="ivory" onClick={onClose}>← Back to Site</Btn>
      </div>

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:12,marginBottom:26}}>
        {[["🐕","Listings",dogs.length],["✅","Available",dogs.filter((d: any) =>d.status!=="adopted").length],["🏠","Adopted",dogs.filter((d: any) =>d.status==="adopted").length],["📋","Applications",apps.length]].map(([ico,lbl,val])=>(
          <div key={lbl} style={{background:"#fff",border:"1px solid rgba(196,121,58,.15)",borderRadius:15,padding:"18px 16px",boxShadow:"0 2px 12px rgba(44,24,16,.06)"}}>
            <div style={{fontSize:"1.4rem",marginBottom:5}}>{ico}</div>
            <div className="serif" style={{fontFamily:"'Playfair Display',serif",fontSize:"1.8rem",fontWeight:900,color:"var(--terracotta)"}}>{L?"—":val}</div>
            <div style={{fontSize:".69rem",color:"var(--t3)",textTransform:"uppercase",letterSpacing:".09em",fontWeight:600,marginTop:2}}>{lbl}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{display:"flex",gap:8,marginBottom:24,flexWrap:"wrap"}}>
        {[["dogs","🐕 Dogs"],["apps","📋 Applications"],["gallery","📸 Gallery"]].map(([k,l])=>(
          <button key={k} onClick={()=>setTab(k)} style={{padding:"8px 20px",borderRadius:50,
            border:`1.5px solid ${tab===k?"var(--warm)":"rgba(196,121,58,.22)"}`,
            background:tab===k?"linear-gradient(135deg,#b86830,#e8955a)":"#fff",
            color:tab===k?"#fff":"var(--t2)",cursor:"pointer",fontSize:".86rem",fontWeight:700,
            boxShadow:tab===k?"0 3px 14px rgba(196,121,58,.28)":"none",transition:"all .2s"}}>{l}</button>
        ))}
      </div>

      {L?<div style={{textAlign:"center",padding:52}}><Spinner size={36} color="var(--warm)"/></div>:(
        <>
          {tab==="dogs"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
                <h3 className="serif" style={{fontFamily:"'Playfair Display',serif",color:"var(--terracotta)",fontSize:"1.2rem"}}>{dogs.length} Listing{dogs.length!==1?"s":""}</h3>
                <Btn onClick={()=>setAdd(true)}>➕ Add New Yorkie</Btn>
              </div>
              {dogs.length===0
                ?<div style={{textAlign:"center",padding:52,color:"var(--t3)"}}>
                   <div style={{fontSize:"3rem",marginBottom:12}}>🐾</div><p>No dogs yet. Add the first one!</p>
                 </div>
                :<div className="auto-cards">
                   {dogs.map((d: any, i: any) =><DogCard key={d.id} dog={d} admin
                     onDelete={async id=>{await API.deleteDog(id);setDogs((x: any[]) =>x.filter((d: any) =>d.id!==id));toast("Dog removed.");}}
                     onEdit={setEdit} delay={i*60}/>)}
                 </div>}
            </div>
          )}

          {tab==="apps"&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <h3 className="serif" style={{fontFamily:"'Playfair Display',serif",color:"var(--terracotta)",fontSize:"1.2rem"}}>{apps.length} Application{apps.length!==1?"s":""}</h3>
                <Btn v="ghost" small onClick={()=>setTick(x=>x+1)}>🔄 Refresh</Btn>
              </div>
              {apps.length===0
                ?<div style={{textAlign:"center",padding:52,color:"var(--t3)"}}>
                   <div style={{fontSize:"3rem",marginBottom:12}}>📋</div><p>No applications yet.</p>
                 </div>
                :<div style={{display:"flex",flexDirection:"column",gap:14}}>
                   {apps.map(a=>(
                     <div key={a.id} style={{background:"#fff",border:`1px solid rgba(196,121,58,${a.status==="pending" ? .25 : .1})`,borderRadius:16,padding:"18px 22px",boxShadow:"0 2px 14px rgba(44,24,16,.06)"}}>
                       <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:10}}>
                         <div>
                           <div style={{fontWeight:800,color:"var(--deep)",fontSize:"1rem"}}>{a.firstName} {a.lastName}</div>
                           <div style={{color:"var(--t3)",fontSize:".81rem"}}>{a.email} · {a.phone}</div>
                           <div style={{color:"var(--warm)",fontSize:".81rem",marginTop:3}}>Dog: <strong>{a.dogName}</strong> · {a.location} · {a.timeline}</div>
                           {a.living&&<div style={{color:"var(--t3)",fontSize:".78rem"}}>Living: {a.living}{a.experience?` · Experience: ${a.experience}`:""}</div>}
                           <div style={{color:"var(--t3)",fontSize:".74rem",marginTop:2}}>{new Date(a.submittedAt).toLocaleString()} · ID: {a.id.slice(0,8).toUpperCase()}</div>
                         </div>
                         <div style={{display:"flex",gap:7,flexWrap:"wrap",alignItems:"flex-start"}}>
                           <span style={{padding:"3px 12px",borderRadius:20,fontSize:".72rem",fontWeight:800,
                             background:"rgba(80,140,80,.12)",
                             color:"#2d7a2d",
                             border:"1px solid rgba(80,140,80,.25)"}}>
                             ✅ AUTO-APPROVED
                           </span>
                           {a.status==="rejected"&&(
                             <span style={{padding:"3px 12px",borderRadius:20,fontSize:".72rem",fontWeight:800,
                               background:"rgba(160,50,50,.1)",color:"#9a2020",
                               border:"1px solid rgba(160,50,50,.25)"}}>WITHDRAWN</span>
                           )}
                         </div>
                       </div>
                       {a.message&&<p style={{color:"var(--t2)",fontSize:".84rem",borderTop:"1px solid rgba(196,121,58,.1)",paddingTop:9,marginTop:4}}>{a.message}</p>}
                       {/* AI Review Card */}
                       <div style={{marginTop:14,borderRadius:14,overflow:"hidden",border:"1px solid rgba(196,121,58,.18)"}}>
                         {/* AI Header */}
                         <div style={{background:"linear-gradient(135deg,rgba(196,121,58,.12),rgba(196,121,58,.06))",
                           padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8,
                           borderBottom:"1px solid rgba(196,121,58,.12)"}}>
                           <div style={{display:"flex",alignItems:"center",gap:8}}>
                             <span style={{fontSize:"1rem"}}>🤖</span>
                             <span style={{fontSize:".78rem",fontWeight:800,color:"var(--terracotta)",textTransform:"uppercase",letterSpacing:".07em"}}>AI Applicant Review</span>
                             {a.aiLoading && <><Spinner size={13} color="var(--warm)"/><span style={{fontSize:".73rem",color:"var(--t3)"}}>Analyzing application…</span></>}
                           </div>
                           {a.aiScore != null && (
                             <div style={{display:"flex",alignItems:"center",gap:10}}>
                               {/* Score badge */}
                               <div style={{
                                 background: a.aiScore>=8?"rgba(80,140,80,.12)":a.aiScore>=5?"rgba(196,121,58,.12)":"rgba(160,50,50,.1)",
                                 border:`1.5px solid ${a.aiScore>=8?"rgba(80,140,80,.3)":a.aiScore>=5?"rgba(196,121,58,.3)":"rgba(160,50,50,.25)"}`,
                                 borderRadius:30,padding:"4px 14px",display:"flex",alignItems:"center",gap:6}}>
                                 <span style={{fontFamily:"'Playfair Display',serif",fontSize:"1.2rem",fontWeight:900,
                                   color:a.aiScore>=8?"#2d7a2d":a.aiScore>=5?"var(--terracotta)":"#9a2020"}}>{a.aiScore}/10</span>
                               </div>
                               {/* Recommendation pill */}
                               {a.aiRecommendation && (
                                 <span style={{fontSize:".72rem",fontWeight:800,borderRadius:20,padding:"4px 12px",letterSpacing:".04em",
                                   background: a.aiRecommendation==="Highly Recommended"?"rgba(80,140,80,.12)":a.aiRecommendation==="Recommended"?"rgba(100,160,100,.1)":a.aiRecommendation==="Review Needed"?"rgba(196,121,58,.12)":"rgba(160,50,50,.1)",
                                   color: a.aiRecommendation==="Highly Recommended"?"#2d6a2d":a.aiRecommendation==="Recommended"?"#3a7a3a":a.aiRecommendation==="Review Needed"?"var(--terracotta)":"#9a2020",
                                   border:`1px solid ${a.aiRecommendation==="Highly Recommended"?"rgba(80,140,80,.3)":a.aiRecommendation==="Recommended"?"rgba(100,160,100,.25)":a.aiRecommendation==="Review Needed"?"rgba(196,121,58,.28)":"rgba(160,50,50,.22)"}`}}>
                                   {a.aiRecommendation==="Highly Recommended"?"⭐ Highly Recommended":a.aiRecommendation==="Recommended"?"✅ Recommended":a.aiRecommendation==="Review Needed"?"⚠️ Review Needed":"❌ Not Recommended"}
                                 </span>
                               )}
                             </div>
                           )}
                         </div>

                         {/* AI Body */}
                         <div style={{padding:"14px 16px",background:"rgba(250,246,240,.5)"}}>
                           {a.aiLoading && (
                             <div style={{padding:"8px 0",color:"var(--t3)",fontSize:".85rem"}}>
                               Claude is reviewing this application in the background — check back in a few seconds or click Refresh.
                             </div>
                           )}
                           {a.aiError && !a.aiLoading && (
                             <p style={{color:"#9a2020",fontSize:".83rem"}}>AI review unavailable — API may be unreachable.</p>
                           )}
                           {!a.aiLoading && a.aiSummary && (
                             <>
                               {/* Summary */}
                               <p style={{fontSize:".86rem",color:"var(--t2)",lineHeight:1.7,marginBottom:12,fontStyle:"italic"}}>"{a.aiSummary}"</p>

                               {/* Strengths & Concerns */}
                               {(a.aiStrengths?.length > 0 || a.aiConcerns?.length > 0) && (
                                 <div className="ai-sc-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                                   {a.aiStrengths?.length > 0 && (
                                     <div style={{background:"rgba(80,140,80,.07)",border:"1px solid rgba(80,140,80,.18)",borderRadius:10,padding:"10px 12px"}}>
                                       <div style={{fontSize:".72rem",fontWeight:800,color:"#2d7a2d",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>✅ Strengths</div>
                                       {a.aiStrengths.map((s: any, i: any) => (
                                         <div key={i} style={{fontSize:".8rem",color:"var(--t2)",lineHeight:1.55,marginBottom:3,display:"flex",gap:5,alignItems:"flex-start"}}>
                                           <span style={{color:"#2d7a2d",flexShrink:0,marginTop:2}}>•</span>{s}
                                         </div>
                                       ))}
                                     </div>
                                   )}
                                   {a.aiConcerns?.length > 0 && (
                                     <div style={{background:"rgba(196,121,58,.07)",border:"1px solid rgba(196,121,58,.18)",borderRadius:10,padding:"10px 12px"}}>
                                       <div style={{fontSize:".72rem",fontWeight:800,color:"var(--terracotta)",textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>⚠️ Watch Points</div>
                                       {a.aiConcerns.map((c: any, i: any) => (
                                         <div key={i} style={{fontSize:".8rem",color:"var(--t2)",lineHeight:1.55,marginBottom:3,display:"flex",gap:5,alignItems:"flex-start"}}>
                                           <span style={{color:"var(--warm)",flexShrink:0,marginTop:2}}>•</span>{c}
                                         </div>
                                       ))}
                                     </div>
                                   )}
                                 </div>
                               )}

                               {/* Key Flag */}
                               {a.aiFlags && (
                                 <div style={{background:"rgba(196,121,58,.08)",borderRadius:10,padding:"10px 14px",marginBottom:10,
                                   borderLeft:"3px solid var(--warm)"}}>
                                   <span style={{fontSize:".73rem",fontWeight:800,color:"var(--terracotta)",textTransform:"uppercase",letterSpacing:".06em"}}>💡 Key Insight  </span>
                                   <span style={{fontSize:".82rem",color:"var(--t2)"}}>{a.aiFlags}</span>
                                 </div>
                               )}

                               {/* Suggested follow-up questions */}
                               {a.aiSuggestedQuestions?.length > 0 && (
                                 <details style={{cursor:"pointer"}}>
                                   <summary style={{fontSize:".76rem",fontWeight:700,color:"var(--terracotta)",letterSpacing:".05em",textTransform:"uppercase",userSelect:"none",marginBottom:6}}>
                                     💬 Suggested Follow-up Questions
                                   </summary>
                                   <div style={{paddingTop:8}}>
                                     {a.aiSuggestedQuestions.map((q: any, i: any) => (
                                       <div key={i} style={{fontSize:".8rem",color:"var(--t2)",lineHeight:1.6,marginBottom:5,paddingLeft:14,borderLeft:"2px solid rgba(196,121,58,.25)"}}>
                                         {q}
                                       </div>
                                     ))}
                                   </div>
                                 </details>
                               )}
                             </>
                           )}

                           {/* Email status indicators */}
                           <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10,paddingTop:10,borderTop:"1px solid rgba(196,121,58,.1)"}}>
                             <span style={{fontSize:".72rem",borderRadius:20,padding:"3px 11px",fontWeight:700,
                               background: a.emailOwnerSent?"rgba(80,140,80,.1)":a.emailOwnerFallback?"rgba(196,121,58,.1)":"rgba(160,50,50,.08)",
                               color: a.emailOwnerSent?"#2d7a2d":a.emailOwnerFallback?"var(--terracotta)":"#9a2020",
                               border:`1px solid ${a.emailOwnerSent?"rgba(80,140,80,.25)":a.emailOwnerFallback?"rgba(196,121,58,.25)":"rgba(160,50,50,.2)"}`}}>
                               📧 Owner notified: {a.emailOwnerSent?"Sent ✓":a.emailOwnerFallback?"Fallback used":"Pending"}
                             </span>
                             <span style={{fontSize:".72rem",borderRadius:20,padding:"3px 11px",fontWeight:700,
                               background:"rgba(80,140,80,.09)",color:"#2d7a2d",border:"1px solid rgba(80,140,80,.22)"}}>
                               ✉️ Applicant confirmation: Sent
                             </span>
                           </div>
                         </div>
                       </div>
                     </div>
                   ))}
                 </div>}
            </div>
          )}

          {tab==="gallery"&&<Gallery admin toast={toast}/>}
        </>
      )}

      {addOpen&&<AddDogModal onClose={()=>setAdd(false)} onSave={async d=>{const n=await API.addDog(d);setDogs((x: any[]) => [n, ...x]);setAdd(false);toast(`${n.name} added! 🐾`);}}/>}
      {editDog&&<EditDogModal dog={editDog} onClose={()=>setEdit(null)} onSave={async(id,u)=>{const d=await API.updateDog(id,u);setDogs(x=>x.map(y=>y.id===id?d:y));setEdit(null);toast("Updated!");}}/>}
    </div>
  );
}
/* ═══════════════════════════════════════════════════════════
   ADMIN LOGIN — password field, no hint shown anywhere
═══════════════════════════════════════════════════════════ */
function LoginModal({ open, onClose, onSuccess }) {
  const [pw,   setPw]  = useState("");
  const [err,  setErr] = useState("");
  const [loading, setL]= useState(false);
  const [show, setShow]= useState(false);

  const go = async () => {
    if (!pw.trim()) { setErr("Please enter your password."); return; }
    setL(true);
    await wait(400);
    if (pw === OWNER_PASS) {
      setPw(""); setErr(""); setL(false);
      onSuccess();
    } else {
      setErr("Incorrect password. Please try again.");
      setL(false);
      setPw("");
    }
  };

  return (
    <Modal open={open} title="" sub="" onClose={() => { setPw(""); setErr(""); onClose(); }}>
      {/* Lock icon + title inside body for custom layout */}
      <div style={{ textAlign:"center", marginBottom:24 }}>
        <div style={{
          width:64, height:64, borderRadius:"50%",
          background:"linear-gradient(135deg,rgba(196,121,58,.15),rgba(196,121,58,.08))",
          border:"2px solid rgba(196,121,58,.25)",
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:"1.8rem", margin:"0 auto 14px",
        }}>🔒</div>
        <h2 style={{ fontFamily:"'Playfair Display',serif", color:"var(--terracotta)",
          fontSize:"1.6rem", fontWeight:700, marginBottom:6 }}>Admin Access</h2>
        <p style={{ color:"var(--t3)", fontSize:".85rem" }}>Enter your password to access the dashboard</p>
      </div>

      {/* Password field */}
      <div style={{ marginBottom:20 }}>
        <div style={{ position:"relative" }}>
          <input
            type={show ? "text" : "password"}
            value={pw}
            onChange={e => { setPw(e.target.value); setErr(""); }}
            onKeyDown={e => e.key === "Enter" && go()}
            placeholder="Enter password"
            autoComplete="new-password"
            autoFocus
            style={{
              width:"100%", padding:"14px 50px 14px 18px",
              background:"#fff",
              border:`2px solid ${err ? "#b03030" : "rgba(196,121,58,.3)"}`,
              borderRadius:13, color:"var(--deep)", fontSize:"1rem",
              transition:"border-color .2s, box-shadow .2s",
              letterSpacing: show ? ".02em" : ".2em",
              boxShadow: err ? "0 0 0 3px rgba(176,48,48,.1)" : "none",
            }}
          />
          {/* Show / hide eye */}
          <button
            onClick={() => setShow(s => !s)}
            type="button"
            tabIndex={-1}
            style={{
              position:"absolute", right:14, top:"50%", transform:"translateY(-50%)",
              background:"none", border:"none", cursor:"pointer",
              color:"var(--t3)", fontSize:"1.1rem", padding:4,
              lineHeight:1, display:"flex", alignItems:"center",
            }}>
            {show ? "🙈" : "👁️"}
          </button>
        </div>
        {err && (
          <div style={{
            display:"flex", alignItems:"center", gap:6,
            marginTop:8, padding:"8px 12px", borderRadius:9,
            background:"rgba(176,48,48,.07)", border:"1px solid rgba(176,48,48,.2)",
          }}>
            <span style={{ fontSize:".9rem" }}>⚠️</span>
            <p style={{ color:"#b03030", fontSize:".8rem", fontWeight:600 }}>{err}</p>
          </div>
        )}
      </div>

      <Btn full onClick={go} loading={loading} sx={{ fontSize:"1rem", padding:"14px" }}>
        {loading ? "Verifying…" : "Access Dashboard →"}
      </Btn>
    </Modal>
  );
}

/* ═══════════════════════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════════════════════ */
function Footer() {
  return (
    <footer style={{background:"var(--deep)",borderTop:"1px solid rgba(196,121,58,.15)",padding:"46px 5vw 28px",textAlign:"center"}}>
      <div className="serif" style={{fontFamily:"'Playfair Display',serif",fontSize:"1.6rem",color:"var(--warm3)",marginBottom:8,fontWeight:700}}>🐾 Janet Companion Yorkie Rescue</div>
      <p style={{marginBottom:6,fontSize:".88rem",color:"rgba(250,246,240,.5)"}}>Dedicated to placing Yorkshire Terriers in loving forever homes.</p>
      <p style={{marginBottom:20}}>
        <a href={`mailto:${OWNER_EMAIL}`} style={{color:"var(--warm2)",textDecoration:"none",fontSize:".9rem"}}>{OWNER_EMAIL}</a>
      </p>
      <div style={{display:"flex",justifyContent:"center",gap:20,flexWrap:"wrap",fontSize:".81rem",marginBottom:20}}>
        {[["#dogs","Our Yorkies"],["#about","About"],["#gallery","Gallery"],["#contact","Adopt Now"]].map(([href,lbl])=>(
          <a key={href} href={href} style={{color:"rgba(250,246,240,.38)",textDecoration:"none",transition:"color .2s"}}
            onMouseEnter={e=>{const el=e.currentTarget;el.style.color="var(--warm2)"}}
            onMouseLeave={e=>{const el=e.currentTarget;el.style.color="rgba(250,246,240,.38)"}}>{lbl}</a>
        ))}
      </div>
      <p style={{fontSize:".72rem",color:"rgba(250,246,240,.18)"}}>© 2024 Janet Companion Yorkie Rescue · All rights reserved</p>
    </footer>
  );
}


/* ═══════════════════════════════════════════════════════════
   WHATSAPP FLOATING BUTTON
═══════════════════════════════════════════════════════════ */
function WhatsAppButton() {
  const [hov, setHov] = useState(false);
  const phone = "12724129441";
  const msg = encodeURIComponent("Hi Janet! I'm interested in adopting a Yorkie 🐾");
  return (
    <a
      href={`https://wa.me/${phone}?text=${msg}`}
      target="_blank"
      rel="noopener noreferrer"
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        position: "fixed",
        bottom: 28,
        right: 28,
        zIndex: 8888,
        width: 60,
        height: 60,
        borderRadius: "50%",
        background: hov ? "#1ebe57" : "#25D366",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: hov
          ? "0 6px 28px rgba(37,211,102,.65), 0 0 0 6px rgba(37,211,102,.18)"
          : "0 4px 18px rgba(37,211,102,.5)",
        transform: hov ? "scale(1.12)" : "scale(1)",
        transition: "all .25s cubic-bezier(.34,1.56,.64,1)",
        textDecoration: "none",
        animation: "waFloat 3s ease-in-out infinite",
      }}
      title="Chat with us on WhatsApp"
    >
      {/* WhatsApp SVG icon */}
      <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M16 3C8.82 3 3 8.82 3 16c0 2.42.65 4.7 1.78 6.67L3 29l6.53-1.71A13 13 0 0016 29c7.18 0 13-5.82 13-13S23.18 3 16 3z" fill="#fff"/>
        <path d="M22.5 19.44c-.3-.15-1.77-.87-2.04-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51-.17-.01-.37-.01-.57-.01s-.52.07-.8.37c-.27.3-1.04 1.02-1.04 2.49s1.07 2.89 1.22 3.09c.15.2 2.1 3.2 5.08 4.49.71.31 1.27.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.77-.72 2.02-1.42.25-.7.25-1.3.17-1.42-.07-.12-.27-.2-.57-.35z" fill="#25D366"/>
      </svg>
      {/* Pulse ring */}
      <span style={{
        position: "absolute",
        width: "100%",
        height: "100%",
        borderRadius: "50%",
        background: "rgba(37,211,102,.35)",
        animation: "waPulse 2s ease-out infinite",
        pointerEvents: "none",
      }}/>
    </a>
  );
}

/* ═══════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════ */
export default function App() {
  const [dogs,   setDogs]  = useState<any[]>([]);
  const [loading,setLoad]  = useState(true);
  const [adoptDog,setAdopt]= useState(null);
  const [login,  setLogin] = useState(false);
  const [admin,  setAdmin] = useState(false);
  const { toasts, add: toast } = useToast();

  // Always read directly from localStorage — never stale
  const loadDogs = useCallback(async () => {
    setLoad(true);
    const fresh = DB.dogs();
    setDogs([...fresh]);
    setLoad(false);
  }, []);

  useEffect(() => { loadDogs(); }, [loadDogs]);

  // Reload dogs whenever user returns to this tab (e.g. after admin session)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadDogs();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadDogs]);

  useReveal();

  if (admin) return (
    <>
      <style>{CSS}</style>
      <Nav onAdmin={() => setAdmin(false)} />
      <AdminDash onClose={() => { setAdmin(false); loadDogs(); }} toast={toast} />
      <Footer />
      <Toasts toasts={toasts} />
    </>
  );

  const available = dogs.filter((d: any) => d.status !== "adopted").length;
  return (
    <>
      <style>{CSS}</style>
      <Nav onAdmin={() => setLogin(true)} />
      <Hero available={available} />
      <DogsSection dogs={dogs} loading={loading} onAdopt={setAdopt}
        onDelete={async id => { await API.deleteDog(id); setDogs(x => x.filter(d => d.id !== id)); }}
        onEdit={() => {}} />
      <About />
      <Gallery admin={false} toast={toast} />
      <Contact />
      <Footer />
      <WhatsAppButton />
      <LoginModal open={login} onClose={() => setLogin(false)} onSuccess={() => { setLogin(false); setAdmin(true); }} />
      {adoptDog && (
        <AdoptModal dog={adoptDog} onClose={() => setAdopt(null)}
          onSubmit={async data => {
            const r = await API.submitApp(data);
            toast(`Application for ${data.dogName} submitted! 🐾`);
            return r;
          }} />
      )}
      <Toasts toasts={toasts} />
    </>
  );
}