const express = require("express");
const path = require("path");
require("dotenv").config();

// Node 18+ has global fetch. If your runtime is older, this fallback works.
const fetchFn =
  global.fetch ||
  ((...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args)));

const app = express();
app.use(express.json());

// Serve public folder
app.use("/public", express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// ✅ IMPORTANT: Keep BASE_URL exactly same as your Render service URL
const BASE_URL = process.env.BASE_URL || "https://jira-plugin-connect-clean-1.onrender.com";

// ------------------------------
// ✅ Jira Connect lifecycle hooks
// ------------------------------
app.post("/installed", (req, res) => {
  console.log("✅ /installed called");
  console.log("Host:", req.body?.baseUrl);
  console.log("clientKey:", req.body?.clientKey);
  return res.status(204).send();
});

app.post("/uninstalled", (req, res) => {
  console.log("❌ /uninstalled called");
  console.log(req.body);
  return res.status(204).send();
});

// ------------------------------
// ✅ Descriptor (Panel + Dialog)
// ------------------------------
app.get("/atlassian-connect.json", (req, res) => {
  const descriptor = {
    apiVersion: 1,

    key: "jira-gemini-connect-render",
    name: "Jira Gemini Connect",
    description: "Refine Jira issue descriptions using Gemini AI",

    vendor: {
      name: "Jira Gemini Connect",
      url: BASE_URL
    },

    baseUrl: BASE_URL,

    links: {
      self: `${BASE_URL}/atlassian-connect.json`
    },

    authentication: { type: "jwt" },
    apiMigrations: { "context-qsh": true },
    lifecycle: { installed: "/installed" },

    scopes: ["READ", "WRITE"],

    modules: {
      jiraIssueContents: [
        {
          key: "aava-refiner-panel",
          name: { value: "AAVA Refiner" },
          location: "atl.jira.view.issue.right.context",
          target: {
            type: "web_panel",
            url: "/public/panel.html?issueKey={issue.key}"
          },
          icon: { width: 16, height: 16, url: "/icon.png" },
          tooltip: { value: "Refine issue description using Gemini AI" }
        }
      ],

      dialogs: [
        {
          key: "aava-refiner-dialog",
          url: "/public/dialog.html?issueKey={issue.key}",
          options: {
            size: "large",
            header: { value: "Enhanced Description" }
          }
        }
      ]
    }
  };

  res.status(200).json(descriptor);
});

// ------------------------------
// ✅ Gemini API endpoint
// ------------------------------
app.post("/api/gemini", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt || !prompt.trim()) {
      return res.status(400).json({ error: "prompt required" });
    }

    const API_KEY = process.env.GEMINI_API_KEY;
    const MODEL = process.env.GEMINI_MODEL; // example: models/gemini-1.5-flash

    if (!API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY missing" });
    if (!MODEL) return res.status(500).json({ error: "GEMINI_MODEL missing" });

    // If model supports only bidiGenerateContent then use that, else generateContent
    const isBidi = MODEL.toLowerCase().includes("native-audio-preview");
    const method = isBidi ? "bidiGenerateContent" : "generateContent";

    const url = `https://generativelanguage.googleapis.com/v1beta/${MODEL}:${method}`;

    console.log("➡️ Gemini URL:", url);

    const r = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": API_KEY
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }]
      })
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("❌ Gemini API error:", data);
      return res.status(r.status).json({
        error: data?.error?.message || "Gemini API error",
        details: data
      });
    }

    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p?.text)
      .filter(Boolean)
      .join("\n")
      .trim();

    if (!text) {
      return res.status(502).json({
        error: "No text returned from Gemini",
        details: data
      });
    }

    return res.json({ response: text });
  } catch (err) {
    console.error("❌ /api/gemini crashed:", err);
    return res.status(500).json({
      error: "Gemini call crashed",
      details: String(err)
    });
  }
});

// ------------------------------
app.get("/", (req, res) => {
  res.send("✅ Jira Gemini Connect is running.");
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`✅ Descriptor: ${BASE_URL}/atlassian-connect.json`);
});
