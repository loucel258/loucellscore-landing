/*!
 * Loucells Core Agent Widget
 * Embed a Loucells Core-powered chat agent on any allowlisted site.
 *
 *   <script src="https://loucellscore.com/agent.js"
 *           data-agent="acme-medspa"
 *           defer></script>
 *
 * Notes:
 *   - Renders natively in the parent DOM (not iframe) so the request
 *     Origin matches the page that hosts the widget.
 *   - Style + DOM are scoped via Shadow DOM — parent page CSS cannot
 *     leak in, and our styles cannot leak out.
 *   - Session id (and the server-signed session token, when the server
 *     issues one) live in sessionStorage keyed by slug.
 *   - All network traffic flows through Loucells Core's Trust Stack (DLP,
 *     audit log, rate limit, origin allowlist, encryption at rest).
 */
(function () {
  "use strict";
  if (window.__loucelsAgentLoaded) return;
  window.__loucelsAgentLoaded = true;

  var script = document.currentScript;
  if (!script) {
    // currentScript is null when the script is loaded async after parse;
    // fall back to the last <script> with data-agent.
    var all = document.querySelectorAll("script[data-agent]");
    script = all[all.length - 1] || null;
  }
  if (!script) return;

  var slug = script.getAttribute("data-agent");
  if (!slug || !/^[a-z0-9-]{1,80}$/.test(slug)) {
    console.error("[loucels] data-agent slug is missing or invalid");
    return;
  }

  // Optional UI language override. Useful for bilingual host sites that
  // know the visitor's locale (e.g. /es/* routes) better than the agent
  // config does.
  var forcedLang = script.getAttribute("data-lang");
  if (forcedLang !== "en" && forcedLang !== "es") forcedLang = null;

  // Derive API origin from the script src so the widget always talks to
  // the same host that served it (no cross-host surprises if the file is
  // mirrored on a CDN).
  var apiOrigin;
  try {
    apiOrigin = new URL(script.src).origin;
  } catch (e) {
    console.error("[loucels] could not parse script src");
    return;
  }

  var SESSION_KEY = "loucels-session-" + slug;
  var HISTORY_KEY = "loucels-chat-" + slug;
  // Signed session token issued by the server for this sessionId. Lives
  // next to the sessionId (same storage, same lifetime) and is sent back
  // with every message. The server may rotate both (e.g. an expired token
  // starts a fresh session), so they are always stored together.
  var TOKEN_KEY = "loucels-session-token-" + slug;
  var sessionId =
    sessionStorage.getItem(SESSION_KEY) ||
    "s_" +
      Math.random().toString(36).slice(2, 10) +
      Date.now().toString(36).slice(-6);
  sessionStorage.setItem(SESSION_KEY, sessionId);
  var sessionToken = null;
  try {
    sessionToken = sessionStorage.getItem(TOKEN_KEY);
  } catch (e) {
    sessionToken = null;
  }

  function adoptSession(body) {
    if (!body || typeof body.sessionToken !== "string" || !body.sessionToken) return;
    if (body.sessionToken.length > 512) return;
    var nextId = typeof body.sessionId === "string" ? body.sessionId : sessionId;
    if (nextId.length < 8 || nextId.length > 64) return;
    sessionId = nextId;
    sessionToken = body.sessionToken;
    try {
      sessionStorage.setItem(SESSION_KEY, sessionId);
      sessionStorage.setItem(TOKEN_KEY, sessionToken);
    } catch (e) {
      // Storage full or blocked: keep the pair in memory for this page.
    }
  }

  // ── State ───────────────────────────────────────────────────────────
  var config = {
    name: "Assistant",
    brandColor: "#0891b2",
    greetingMessage: null,
    language: "en",
  };
  // Conversation history persists in sessionStorage (same lifetime as
  // the sessionId: survives refresh and in-site navigation, dies with
  // the tab). Without this, a refresh mid-conversation gave the agent
  // total amnesia — the context window is client-held.
  var messages = loadHistory(); // [{ role: "user" | "assistant", content }]
  var isOpen = false;
  var isSending = false;

  function loadHistory() {
    try {
      var raw = sessionStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(function (m) {
          return (
            m &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string"
          );
        })
        .slice(-40);
    } catch (e) {
      return [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-40)));
    } catch (e) {
      // Storage full or blocked — degrade to in-memory only.
    }
  }

  // ── DOM scaffolding (Shadow DOM root) ───────────────────────────────
  var host = document.createElement("div");
  host.id = "loucels-agent-root";
  host.style.cssText =
    "position:fixed;bottom:0;right:0;z-index:2147483646;width:0;height:0;";
  // Smooth-scroll libraries (Lenis, Locomotive) hijack wheel events at
  // the page level and would scroll the HOST page instead of the chat.
  // Lenis honors this attribute; shadow retargeting makes the host the
  // visible event target, so marking it covers everything inside.
  host.setAttribute("data-lenis-prevent", "");
  var shadow = host.attachShadow({ mode: "closed" });
  // Mount after DOMContentLoaded so we don't trip frameworks that
  // re-hydrate <body> on first paint.
  function mount() {
    document.body.appendChild(host);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }

  // ── Hydrate config from server, then render ─────────────────────────
  fetch(apiOrigin + "/api/agent/" + encodeURIComponent(slug) + "/widget-config", {
    method: "GET",
    credentials: "omit",
  })
    .then(function (r) {
      if (!r.ok) throw new Error("config_unavailable:" + r.status);
      return r.json();
    })
    .then(function (data) {
      if (data && data.ok && data.config) {
        config.name = data.config.name || config.name;
        config.brandColor = data.config.brandColor || config.brandColor;
        config.greetingMessage = data.config.greetingMessage || null;
        config.language = forcedLang || data.config.language || "en";
      }
      render();
      flushPending();
    })
    .catch(function (err) {
      // Don't surface to the page — log and skip render. This is the
      // expected path when the embed runs on a domain not in the
      // tenant's allowed_origins (the browser blocks the response).
      console.warn("[loucels] widget unavailable:", err.message);
    });

  // ── Rendering ───────────────────────────────────────────────────────
  function t(en, es) {
    return config.language === "es" ? es : en;
  }

  function render() {
    var styles = document.createElement("style");
    styles.textContent =
      ":host{all:initial}" +
      "*,*::before,*::after{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif}" +
      ".launcher{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:9999px;border:none;cursor:pointer;background:" +
      config.brandColor +
      ";color:white;box-shadow:0 10px 25px -5px rgba(0,0,0,.25),0 8px 10px -6px rgba(0,0,0,.2);display:flex;align-items:center;justify-content:center;transition:transform .15s ease,box-shadow .15s ease}" +
      ".launcher:hover{transform:translateY(-2px);box-shadow:0 14px 30px -5px rgba(0,0,0,.3)}" +
      ".launcher svg{width:26px;height:26px}" +
      ".panel{position:fixed;bottom:100px;right:24px;width:380px;max-width:calc(100vw - 32px);height:580px;max-height:calc(100vh - 120px);background:white;border-radius:20px;box-shadow:0 25px 60px -15px rgba(0,0,0,.35),0 0 0 1px rgba(0,0,0,.06);display:flex;flex-direction:column;overflow:hidden;opacity:0;transform:translateY(8px) scale(.98);pointer-events:none;transition:opacity .18s ease,transform .18s ease}" +
      ".panel.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}" +
      // Mobile: fill the screen. height is driven by JS via the
      // visualViewport API (see syncViewport) so the composer rides
      // above the on-screen keyboard instead of being buried under it.
      // dvh is the static fallback before/without that sync.
      "@media (max-width: 480px){.panel{position:fixed;top:0;left:0;right:0;width:100vw;height:100dvh;max-width:100vw;max-height:100dvh;border-radius:0;bottom:auto}.launcher{bottom:16px;right:16px}}" +
      ".header{padding:16px 20px;background:" +
      config.brandColor +
      ";color:white;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-shrink:0}" +
      ".header-title{font-weight:600;font-size:15px;letter-spacing:-.01em}" +
      ".header-sub{font-size:11px;opacity:.85;margin-top:2px}" +
      ".close{background:rgba(255,255,255,.15);border:none;color:white;width:30px;height:30px;border-radius:9999px;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}" +
      ".close:hover{background:rgba(255,255,255,.25)}" +
      ".messages{flex:1;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:16px;display:flex;flex-direction:column;gap:10px;background:#fafafa}" +
      ".bubble{max-width:85%;padding:10px 14px;border-radius:16px;font-size:14px;line-height:1.45;white-space:pre-wrap;word-wrap:break-word;animation:fade .18s ease}" +
      "@keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}" +
      ".bubble.user{align-self:flex-end;background:" +
      config.brandColor +
      ";color:white;border-bottom-right-radius:6px}" +
      ".bubble.assistant{align-self:flex-start;background:white;color:#171717;border:1px solid #e5e5e5;border-bottom-left-radius:6px}" +
      ".bubble.assistant strong{font-weight:600;color:#0a0a0a}" +
      ".bubble.assistant em{font-style:italic}" +
      ".bubble.assistant code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;background:#f5f5f5;padding:1px 5px;border-radius:4px}" +
      ".bubble.assistant a{color:" + config.brandColor + ";text-decoration:underline;text-underline-offset:2px}" +
      ".bubble.error{align-self:flex-start;background:#fef2f2;color:#991b1b;border:1px solid #fecaca;font-size:13px}" +
      ".typing{display:inline-flex;gap:4px;padding:6px 0}" +
      ".typing span{width:6px;height:6px;background:#a3a3a3;border-radius:9999px;animation:blink 1.2s infinite}" +
      ".typing span:nth-child(2){animation-delay:.2s}.typing span:nth-child(3){animation-delay:.4s}" +
      "@keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}" +
      ".composer{display:flex;gap:8px;padding:12px;border-top:1px solid #e5e5e5;background:white;flex-shrink:0}" +
      // font-size MUST be >=16px: iOS Safari auto-zooms the whole page
      // when focusing an input under 16px, which is the "everything got
      // big" effect on phones. 16px keeps the page put.
      ".composer textarea{flex:1;border:1px solid #d4d4d4;border-radius:12px;padding:10px 12px;font-size:16px;resize:none;outline:none;font-family:inherit;color:#171717;background:white;min-height:42px;max-height:120px}" +
      ".composer textarea:focus{border-color:" +
      config.brandColor +
      ";box-shadow:0 0 0 3px " +
      hexToAlpha(config.brandColor, 0.15) +
      "}" +
      ".composer button{background:" +
      config.brandColor +
      ";color:white;border:none;border-radius:12px;padding:0 16px;font-size:14px;font-weight:600;cursor:pointer;flex-shrink:0}" +
      ".composer button:disabled{opacity:.5;cursor:not-allowed}" +
      ".footer{padding:8px 12px;background:white;border-top:1px solid #f5f5f5;text-align:center;font-size:10px;color:#a3a3a3}" +
      ".footer a{color:#737373;text-decoration:none}";
    shadow.appendChild(styles);

    var launcher = document.createElement("button");
    launcher.className = "launcher";
    launcher.setAttribute("aria-label", t("Open chat", "Abrir chat"));
    launcher.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    launcher.addEventListener("click", togglePanel);
    shadow.appendChild(launcher);

    var panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", config.name);
    panel.innerHTML =
      '<div class="header">' +
      '<div><div class="header-title">' +
      escapeHtml(config.name) +
      '</div><div class="header-sub">' +
      t("Powered by Loucells Core", "Hecho con Loucells Core") +
      "</div></div>" +
      '<button class="close" aria-label="' +
      t("Close", "Cerrar") +
      '">×</button>' +
      "</div>" +
      '<div class="messages" id="msgs"></div>' +
      '<form class="composer" id="form">' +
      '<textarea id="input" rows="1" placeholder="' +
      t("Type your message…", "Escribe tu mensaje…") +
      '" aria-label="' +
      t("Your message", "Tu mensaje") +
      '"></textarea>' +
      '<button type="submit" id="send">' +
      t("Send", "Enviar") +
      "</button>" +
      "</form>" +
      '<div class="footer"><a href="https://loucellscore.com" target="_blank" rel="noopener">' +
      t("Powered by Loucells Core — Trust Stack", "Hecho con Loucells Core — Trust Stack") +
      "</a></div>";
    shadow.appendChild(panel);

    // Keep wheel/touch gestures inside the panel from bubbling out to
    // page-level smooth-scroll listeners (belt and suspenders alongside
    // the data-lenis-prevent attribute on the host).
    panel.addEventListener(
      "wheel",
      function (e) {
        e.stopPropagation();
      },
      { passive: true },
    );
    panel.addEventListener(
      "touchmove",
      function (e) {
        e.stopPropagation();
      },
      { passive: true },
    );

    panel.querySelector(".close").addEventListener("click", togglePanel);
    var form = panel.querySelector("#form");
    var input = panel.querySelector("#input");
    var sendBtn = panel.querySelector("#send");

    input.addEventListener("input", function () {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text || isSending) return;
      input.value = "";
      input.style.height = "auto";
      sendMessage(text);
    });

    // Save references for later DOM mutations
    panel._refs = {
      panel: panel,
      messages: panel.querySelector("#msgs"),
      sendBtn: sendBtn,
      input: input,
    };
    shadow._panel = panel;

    // Seed greeting (visual only — not persisted as a real assistant turn)
    if (config.greetingMessage) {
      pushBubble("assistant", config.greetingMessage);
    }

    // Re-render the persisted conversation after a refresh / navigation.
    for (var i = 0; i < messages.length; i++) {
      pushBubble(messages[i].role, messages[i].content);
    }
  }

  function togglePanel() {
    setPanelOpen(!isOpen);
  }

  // On mobile the on-screen keyboard shrinks the *visual* viewport but
  // not the layout viewport, so a 100dvh panel keeps its bottom (the
  // composer) hidden behind the keyboard. We pin the panel to the
  // visual viewport instead: its height becomes the visible area and it
  // offsets down by however far the page scrolled under the keyboard.
  // Desktop and the non-open state clear the overrides.
  function syncViewport() {
    var panel = shadow._panel;
    if (!panel) return;
    var vv = window.visualViewport;
    var isMobile = window.matchMedia("(max-width: 480px)").matches;
    if (!isMobile || !vv || !panel.classList.contains("open")) {
      panel.style.height = "";
      panel.style.top = "";
      return;
    }
    panel.style.height = vv.height + "px";
    panel.style.top = vv.offsetTop + "px";
    // keep the latest message in view as the area shrinks
    var msgs = panel._refs && panel._refs.messages;
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  if (typeof window !== "undefined" && window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewport);
    window.visualViewport.addEventListener("scroll", syncViewport);
  }

  function setPanelOpen(next) {
    var panel = shadow._panel;
    if (!panel) return;
    isOpen = next;
    panel.classList.toggle("open", isOpen);
    if (isOpen) {
      syncViewport();
      setTimeout(function () {
        panel._refs.input.focus();
        // focus pops the keyboard; re-sync once it has animated in
        setTimeout(syncViewport, 300);
      }, 200);
    } else {
      syncViewport();
    }
  }

  // ── Public API ──────────────────────────────────────────────────────
  // Host pages can open the chat programmatically — e.g. a "Book via
  // chat" CTA that pre-sends a booking-intent prompt. Two surfaces:
  //
  //   window.LoucelsAgent.open("optional prompt to auto-send")
  //   window.dispatchEvent(new CustomEvent("loucels:open-chat",
  //     { detail: { prompt: "..." } }))
  //
  // Calls made before the widget finishes hydrating are queued and
  // flushed after first render.
  var pendingPrompt = null;
  var pendingOpen = false;

  function openWithPrompt(prompt) {
    if (!shadow._panel) {
      pendingOpen = true;
      if (prompt) pendingPrompt = String(prompt);
      return;
    }
    setPanelOpen(true);
    if (prompt && !isSending) sendMessage(String(prompt).slice(0, 4000));
  }

  function flushPending() {
    if (pendingOpen) {
      var p = pendingPrompt;
      pendingOpen = false;
      pendingPrompt = null;
      openWithPrompt(p);
    }
  }

  window.addEventListener("loucels:open-chat", function (e) {
    var prompt = e && e.detail ? e.detail.prompt : null;
    openWithPrompt(prompt);
  });

  window.LoucelsAgent = {
    open: function (prompt) {
      openWithPrompt(prompt);
    },
    close: function () {
      setPanelOpen(false);
    },
  };

  function pushBubble(role, text) {
    var panel = shadow._panel;
    if (!panel) return null;
    var bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    if (role === "assistant") {
      // Render a safe markdown subset (bold, italic, code, links) by
      // building DOM nodes directly. NEVER use innerHTML with model
      // output — text inside marker groups goes through textContent so
      // an attacker who jailbreaks the prompt can't inject HTML.
      renderMarkdown(bubble, text);
    } else {
      // User content always plain text — even if the user types HTML.
      bubble.textContent = text;
    }
    var msgs = panel._refs.messages;
    msgs.appendChild(bubble);
    if (role === "assistant") {
      // Long replies: park the scroll at the TOP of the new message so
      // the visitor reads from the start instead of landing at the end.
      msgs.scrollTop = Math.max(0, bubble.offsetTop - msgs.offsetTop - 8);
    } else {
      msgs.scrollTop = msgs.scrollHeight;
    }
    return bubble;
  }

  function renderMarkdown(parent, text) {
    var lines = String(text).split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (i > 0) parent.appendChild(document.createElement("br"));
      renderInline(parent, lines[i]);
    }
  }

  // Inline markdown subset. Order matters for ambiguity (** before *).
  var INLINE_PATTERNS = [
    { re: /\*\*([^*\n]+)\*\*/, tag: "strong" },
    { re: /__([^_\n]+)__/, tag: "strong" },
    { re: /\*([^*\n]+)\*/, tag: "em" },
    { re: /_([^_\n]+)_/, tag: "em" },
    { re: /`([^`\n]+)`/, tag: "code" },
    { re: /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/, tag: "a" },
  ];

  function renderInline(parent, line) {
    var remaining = line;
    while (remaining.length > 0) {
      var bestIdx = -1;
      var bestMatch = null;
      var bestPattern = null;
      for (var j = 0; j < INLINE_PATTERNS.length; j++) {
        var p = INLINE_PATTERNS[j];
        var m = p.re.exec(remaining);
        if (m && (bestIdx === -1 || m.index < bestIdx)) {
          bestIdx = m.index;
          bestMatch = m;
          bestPattern = p;
        }
      }
      if (!bestMatch) {
        parent.appendChild(document.createTextNode(remaining));
        return;
      }
      if (bestIdx > 0) {
        parent.appendChild(document.createTextNode(remaining.slice(0, bestIdx)));
      }
      var el = document.createElement(bestPattern.tag);
      if (bestPattern.tag === "a") {
        // bestMatch[2] is already validated as http(s) by the regex.
        el.setAttribute("href", bestMatch[2]);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
        el.textContent = bestMatch[1];
      } else {
        el.textContent = bestMatch[1];
      }
      parent.appendChild(el);
      remaining = remaining.slice(bestIdx + bestMatch[0].length);
    }
  }

  function pushTyping() {
    var panel = shadow._panel;
    if (!panel) return null;
    var bubble = document.createElement("div");
    bubble.className = "bubble assistant";
    bubble.innerHTML = '<span class="typing"><span></span><span></span><span></span></span>';
    panel._refs.messages.appendChild(bubble);
    panel._refs.messages.scrollTop = panel._refs.messages.scrollHeight;
    return bubble;
  }

  function sendMessage(text) {
    isSending = true;
    var panel = shadow._panel;
    panel._refs.sendBtn.disabled = true;
    pushBubble("user", text);
    messages.push({ role: "user", content: text });
    saveHistory();
    var typing = pushTyping();

    var payload = {
      sessionId: sessionId,
      locale: config.language,
      messages: messages.slice(-20),
    };
    if (sessionToken) payload.sessionToken = sessionToken;

    fetch(apiOrigin + "/api/agent/" + encodeURIComponent(slug) + "/chat", {
      method: "POST",
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          return { status: r.status, body: body };
        });
      })
      .then(function (resp) {
        typing.remove();
        if (resp.body && resp.body.ok) adoptSession(resp.body);
        if (resp.body && resp.body.ok && resp.body.reply) {
          pushBubble("assistant", resp.body.reply);
          messages.push({ role: "assistant", content: resp.body.reply });
          saveHistory();
        } else {
          var errMsg = friendlyError(resp.status, resp.body && resp.body.error);
          var b = pushBubble("error", errMsg);
          if (b) b.classList.add("error");
        }
      })
      .catch(function () {
        typing.remove();
        pushBubble(
          "error",
          t(
            "We couldn't reach the assistant. Please try again.",
            "No pudimos conectar con el asistente. Intenta de nuevo.",
          ),
        );
      })
      .then(function () {
        isSending = false;
        panel._refs.sendBtn.disabled = false;
      });
  }

  function friendlyError(status, code) {
    if (status === 429)
      return t(
        "Too many messages — please wait a moment.",
        "Demasiados mensajes — espera un momento.",
      );
    if (status === 413 || code === "input_too_long")
      return t(
        "That message is too long.",
        "Ese mensaje es muy largo.",
      );
    if (code === "pii_blocked")
      return t(
        "Please don't share sensitive info here.",
        "Por favor no compartas información sensible aquí.",
      );
    return t(
      "Something went wrong. Try again in a moment.",
      "Algo salió mal. Intenta de nuevo en un momento.",
    );
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hexToAlpha(hex, alpha) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return "rgba(8,145,178," + alpha + ")";
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }
})();
