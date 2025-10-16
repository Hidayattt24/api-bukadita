const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
require("dotenv").config();
const supabaseClientMiddleware = require("./middlewares/supabase-middleware");

// V1 index router (aggregates individual resource routers)
const v1Index = require("./routes/v1/index");

const app = express();

// Security middleware
app.use(helmet());

// CORS configuration
const allowedOrigins =
  process.env.NODE_ENV === "production"
    ? [
        process.env.FRONTEND_URL || "https://your-frontend-domain.vercel.app",
        // Add multiple domains if needed
        "https://fe-bukadita-web-posyandu.vercel.app",
        // Allow all Vercel preview deployments
        /https:\/\/.*\.vercel\.app$/,
      ]
    : [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:5173",
      ];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);

      // In development, allow all localhost origins
      if (process.env.NODE_ENV !== "production" && origin.includes("localhost")) {
        return callback(null, true);
      }

      // Check if origin matches any allowed pattern
      const isAllowed = allowedOrigins.some((allowed) => {
        if (typeof allowed === "string") {
          return origin === allowed;
        } else if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      });

      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        console.warn(`Allowed origins:`, allowedOrigins);
        callback(null, true); // Allow for now during testing
        // TODO: Change back to: callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Pragma",
      "Expires",
      "X-Requested-With",
    ],
  })
);

// Request logging
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// Body parsing middleware
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// Attach base Supabase clients early (anon + admin). Auth middleware will later inject user-scoped client.
app.use(supabaseClientMiddleware);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "OK",
    message: "Bukadita Backend API is running",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Root endpoint - Welcome message
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to Bukadita Backend API",
    version: "1.0.0",
    endpoints: {
      health: "/health",
      api: "/api/v1",
      auth: "/api/v1/auth",
      modules: "/api/v1/modules",
      materials: "/api/v1/materials",
      quizzes: "/api/v1/quizzes",
      notes: "/api/v1/notes",
      users: "/api/v1/users/me",
    },
    documentation: "/api-docs",
    timestamp: new Date().toISOString(),
  });
});

// Mount aggregated v1 API surface
app.use("/api/v1", v1Index);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: true,
    code: "NOT_FOUND",
    message: "Route not found",
    path: req.originalUrl,
    method: req.method,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error("Global error handler:", error);

  // Handle Joi validation errors
  if (error.isJoi) {
    return res.status(400).json({
      error: true,
      code: "VALIDATION_ERROR",
      message: error.details[0].message,
    });
  }

  // Handle Supabase errors
  if (error.code && error.message) {
    return res
      .status(500)
      .json({ error: true, code: "DB_ERROR", message: error.message });
  }

  // Default error response
  res.status(500).json({
    error: true,
    code: "INTERNAL_ERROR",
    message:
      process.env.NODE_ENV === "production"
        ? "An unexpected error occurred"
        : error.message,
  });
});

module.exports = app;
