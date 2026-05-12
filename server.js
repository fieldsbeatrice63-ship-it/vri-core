const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// ENVIRONMENT CHECK
// =====================================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    system: "VRI Verification & Risk Infrastructure",
    status: "ONLINE",
    halo: "ACTIVE",
    shiftguard: "CONNECTED",
    backend: "RENDER",
    supabase_connected: Boolean(supabaseUrl && supabaseServiceKey)
  });
});

// =====================================================
// SAFE ENVIRONMENT DIAGNOSTIC — DOES NOT SHOW SECRETS
// =====================================================

app.get("/debug-env", (req, res) => {
  res.json({
    supabase_url_loaded: Boolean(supabaseUrl),
    service_role_loaded: Boolean(supabaseServiceKey),
    supabase_url_preview: supabaseUrl
      ? supabaseUrl.substring(0, 30) + "..."
      : "MISSING"
  });
});

// =====================================================
// SHARED HELPERS
// =====================================================

function cleanValue(value, fallback = "") {
  if (value === null || value === undefined) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function createDocumentFingerprint(documentTitle, documentContent) {
  const normalizedDocument = JSON.stringify({
    document_title: cleanValue(documentTitle, "API Verification Document"),
    document_content: cleanValue(documentContent, "VRI API verification record").replace(/\r\n/g, "\n").trim()
  });

  const hash = crypto
    .createHash("sha256")
    .update(normalizedDocument)
    .digest("hex");

  return {
    document_hash: hash,
    original_hash: hash,
    current_hash: hash,
    hash_algorithm: "SHA-256",
    hash_status: "MATCH",
    document_changed: false,
    fingerprint_created_at: new Date().toISOString()
  };
}

function createAiDisclosure(payload) {
  const aiUsed = payload.ai_used === true || String(payload.ai_used).toLowerCase() === "true";
  const humanReviewed = payload.human_reviewed === false || String(payload.human_reviewed).toLowerCase() === "false"
    ? false
    : true;

  const aiToolName = cleanValue(
    payload.ai_tool_name,
    aiUsed ? "AI tool not specified" : "None"
  );

  const aiDisclosureNote = cleanValue(
    payload.ai_disclosure_note,
    aiUsed
      ? "AI assistance was disclosed through the API, but no detailed note was provided."
      : "No AI assistance disclosed."
  );

  let aiContentStatus = "NOT_USED";

  if (aiUsed && humanReviewed) {
    aiContentStatus = "AI_ASSISTED_HUMAN_REVIEWED";
  }

  if (aiUsed && !humanReviewed) {
    aiContentStatus = "AI_ASSISTED_NOT_HUMAN_REVIEWED";
  }

  return {
    ai_used: aiUsed,
    ai_tool_name: aiToolName,
    ai_disclosure_note: aiDisclosureNote,
    human_reviewed: humanReviewed,
    ai_content_status: aiContentStatus,
    ai_disclosed_at: new Date().toISOString()
  };
}

function verifyEmailLight(email) {
  const cleanedEmail = cleanValue(email).toLowerCase();
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!cleanedEmail) return { status: "MISSING", verified_at: "" };

  if (!emailPattern.test(cleanedEmail)) {
    return { status: "INVALID_FORMAT", verified_at: new Date().toISOString() };
  }

  return { status: "FORMAT_VERIFIED", verified_at: new Date().toISOString() };
}

function verifyPhoneLight(phone) {
  const cleanedPhone = cleanValue(phone);
  const digitsOnly = cleanedPhone.replace(/\D/g, "");

  if (!cleanedPhone) return { status: "MISSING", verified_at: "" };

  if (digitsOnly.length < 10) {
    return { status: "INVALID_FORMAT", verified_at: new Date().toISOString() };
  }

  return { status: "FORMAT_VERIFIED", verified_at: new Date().toISOString() };
}

function getOverallEmailStatus(senderEmailVerification, recipientEmailVerification) {
  if (
    senderEmailVerification.status === "FORMAT_VERIFIED" &&
    recipientEmailVerification.status === "FORMAT_VERIFIED"
  ) {
    return "FORMAT_VERIFIED";
  }

  if (
    senderEmailVerification.status === "MISSING" ||
    recipientEmailVerification.status === "MISSING"
  ) {
    return "MISSING";
  }

  return "INVALID_FORMAT";
}

function runHaloGovernance(payload) {
  let score = 100;
  const issues = [];

  const normalizedRisk = cleanValue(payload.risk_level).toUpperCase();
  const emailStatus = payload.email_verification_status || "MISSING";
  const phoneStatus = payload.phone_verification_status || "MISSING";
  const businessName = cleanValue(payload.business_name, "Connected Company");
  const verificationIntent = cleanValue(payload.verification_intent, "API Verification");
  const source = cleanValue(payload.source, "api");

  if (normalizedRisk === "HIGH") {
    score -= 35;
    issues.push("high-risk execution request");
  }

  if (normalizedRisk === "MEDIUM") {
    score -= 15;
    issues.push("medium-risk execution request");
  }

  if (emailStatus === "INVALID_FORMAT") {
    score -= 20;
    issues.push("email format is invalid");
  }

  if (emailStatus === "MISSING") {
    score -= 20;
    issues.push("email is missing");
  }

  if (phoneStatus === "INVALID_FORMAT") {
    score -= 15;
    issues.push("phone format is invalid");
  }

  if (phoneStatus === "MISSING") {
    score -= 10;
    issues.push("phone is missing");
  }

  if (!businessName || businessName === "Individual") {
    score -= 10;
    issues.push("business name was not fully supplied");
  }

  if (!verificationIntent) {
    score -= 10;
    issues.push("verification intent is missing");
  }

  if (source === "external_api") {
    score -= 5;
  }

  if (payload.ai_used === true && payload.human_reviewed === false) {
    score -= 20;
    issues.push("AI-assisted content was not human reviewed");
  }

  if (score < 0) score = 0;

  let riskLevel = "LOW";
  if (score < 75) riskLevel = "MEDIUM";
  if (score < 50) riskLevel = "HIGH";

  if (normalizedRisk === "HIGH") {
    riskLevel = "HIGH";
  }

  const governanceNote = issues.length === 0
    ? "HALO reviewed the API proof source, verification intent, business capture, email signal, phone signal, document fingerprint, AI disclosure, execution action, and receipt readiness. No major governance concerns were detected."
    : "HALO reviewed the API proof source, verification intent, business capture, email signal, phone signal, document fingerprint, AI disclosure, execution action, and receipt readiness. Review needed because: " + issues.join(", ") + ".";

  return {
    status: "GOVERNED",
    risk_level: riskLevel,
    confidence_score: score,
    governance_note: governanceNote
  };
}

function runShiftGuardExecutionLayer(halo, normalizedRisk) {
  let executionState = "APPROVED";
  let supervisorRequired = false;

  if (normalizedRisk === "HIGH" || halo.risk_level === "HIGH") {
    executionState = "ESCALATED";
    supervisorRequired = true;
  }

  return {
    status: supervisorRequired ? "ESCALATED" : "STANDBY",
    mode: supervisorRequired ? "SUPERVISOR_REQUIRED" : "READY",
    execution_state: executionState,
    supervisor_required: supervisorRequired,
    execution_note: supervisorRequired
      ? "ShiftGuard Clinical detected a protected high-risk execution. Supervisor authority is required before final action proceeds."
      : "ShiftGuard Clinical reviewed execution readiness. No live enforcement was triggered."
  };
}

// =====================================================
// CORE VRI VERIFICATION HANDLER
// =====================================================

async function runVriVerification(payload) {
  const {
    api_key,
    actor_name,
    department,
    action,
    risk_level
  } = payload;

  if (!api_key) {
    return {
      httpStatus: 401,
      body: {
        status: "DENIED",
        message: "Missing API key"
      }
    };
  }

  // =====================================================
  // VALIDATE API KEY
  // =====================================================

  const { data: validKey, error: keyError } = await supabase
    .from("api_keys")
    .select("*")
    .eq("api_key", api_key)
    .eq("status", "ACTIVE")
    .single();

  if (keyError || !validKey) {
    return {
      httpStatus: 401,
      body: {
        status: "DENIED",
        message: "Invalid or inactive API key",
        supabase_error: keyError ? keyError.message : null
      }
    };
  }

  // =====================================================
  // NORMALIZED API PAYLOAD
  // =====================================================

  const timestamp = Date.now();
  const proof_id = payload.proof_id || "VRI-API-" + timestamp;
  const execution_id = payload.execution_id || "EXEC-" + timestamp;

  const normalizedRisk = cleanValue(risk_level, "LOW").toUpperCase();
  const companyId = cleanValue(payload.company_id, validKey.company_id || "API_CONNECTED_COMPANY");
  const organizationName = cleanValue(payload.business_name, validKey.organization_name || "Connected Organization");
  const source = "external_api";
  const industry = cleanValue(payload.industry, "enterprise");
  const verificationIntent = cleanValue(payload.verification_intent, "API Verification");

  const senderName = cleanValue(payload.sender_name, actor_name || "API Actor");
  const senderEmail = cleanValue(payload.sender_email, payload.actor_email || "");
  const senderPhone = cleanValue(payload.sender_phone, payload.actor_phone || "");
  const recipientName = cleanValue(payload.recipient_name, "API Recipient");
  const recipientEmail = cleanValue(payload.recipient_email, "");
  const recipientPhone = cleanValue(payload.recipient_phone, "");

  const documentTitle = cleanValue(payload.document_title, action || "API Verification Document");
  const documentContent = cleanValue(
    payload.document_content,
    "API verification record | Actor: " + cleanValue(actor_name, "N/A") +
    " | Department: " + cleanValue(department, "N/A") +
    " | Action: " + cleanValue(action, "N/A") +
    " | Risk Level: " + normalizedRisk
  );

  const senderEmailVerification = verifyEmailLight(senderEmail);
  const recipientEmailVerification = verifyEmailLight(recipientEmail);
  const senderPhoneVerification = verifyPhoneLight(senderPhone);
  const overallEmailStatus = getOverallEmailStatus(senderEmailVerification, recipientEmailVerification);

  const aiDisclosure = createAiDisclosure(payload);
  const fingerprint = createDocumentFingerprint(documentTitle, documentContent);

  const halo = runHaloGovernance({
    risk_level: normalizedRisk,
    email_verification_status: overallEmailStatus,
    phone_verification_status: senderPhoneVerification.status,
    business_name: organizationName,
    verification_intent: verificationIntent,
    source,
    ai_used: aiDisclosure.ai_used,
    human_reviewed: aiDisclosure.human_reviewed
  });

  const shiftguard = runShiftGuardExecutionLayer(halo, normalizedRisk);

  // =====================================================
  // INSERT MAIN PROOF RECORD
  // =====================================================

  const { data: proofRecordData, error: proofRecordError } = await supabase
    .from("proof_records")
    .insert([{
      proof_id,
      company_id: companyId,
      event_type: "api_created",
      source,
      industry,
      status: "VERIFIED",
      verification_note: "Proof record created through VRI enterprise API",
      verification_intent: verificationIntent,
      business_name: organizationName,

      document_hash: fingerprint.document_hash,
      hash_algorithm: fingerprint.hash_algorithm,
      hash_status: fingerprint.hash_status,
      document_changed: fingerprint.document_changed,

      ai_used: aiDisclosure.ai_used,
      ai_tool_name: aiDisclosure.ai_tool_name,
      ai_disclosure_note: aiDisclosure.ai_disclosure_note,
      human_reviewed: aiDisclosure.human_reviewed,
      ai_content_status: aiDisclosure.ai_content_status,
      ai_disclosed_at: aiDisclosure.ai_disclosed_at,

      email_verification_status: overallEmailStatus,
      email_verified_at: recipientEmailVerification.verified_at,
      phone_verification_status: senderPhoneVerification.status,
      phone_verified_at: senderPhoneVerification.verified_at,

      halo_status: halo.status,
      halo_risk_level: halo.risk_level,
      halo_confidence_score: halo.confidence_score,
      halo_governance_note: halo.governance_note,

      shiftguard_status: shiftguard.status,
      shiftguard_mode: shiftguard.mode,
      shiftguard_execution_note: shiftguard.execution_note
    }])
    .select();

  if (proofRecordError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "proof_records insert failed",
        supabase_error: proofRecordError.message,
        details: proofRecordError
      }
    };
  }

  // =====================================================
  // INSERT DOCUMENT RECORD
  // =====================================================

  const { data: documentData, error: documentError } = await supabase
    .from("documents")
    .insert([{
      proof_id,
      company_id: companyId,
      document_title: documentTitle,
      document_type: "api_verification_document",
      document_content: documentContent,

      document_hash: fingerprint.document_hash,
      original_hash: fingerprint.original_hash,
      current_hash: fingerprint.current_hash,
      hash_algorithm: fingerprint.hash_algorithm,
      hash_status: fingerprint.hash_status,
      document_changed: fingerprint.document_changed,
      fingerprint_created_at: fingerprint.fingerprint_created_at,

      ai_used: aiDisclosure.ai_used,
      ai_tool_name: aiDisclosure.ai_tool_name,
      ai_disclosure_note: aiDisclosure.ai_disclosure_note,
      human_reviewed: aiDisclosure.human_reviewed,
      ai_content_status: aiDisclosure.ai_content_status,
      ai_disclosed_at: aiDisclosure.ai_disclosed_at,

      sender_name: senderName,
      sender_email: senderEmail,
      sender_phone: senderPhone,
      sender_business: organizationName,
      recipient_name: recipientName,
      recipient_email: recipientEmail,

      email_verification_status: overallEmailStatus,
      email_verified_at: recipientEmailVerification.verified_at,
      phone_verification_status: senderPhoneVerification.status,
      phone_verified_at: senderPhoneVerification.verified_at,

      verification_intent: verificationIntent,
      business_name: organizationName,

      halo_status: halo.status,
      halo_risk_level: halo.risk_level,
      halo_confidence_score: halo.confidence_score,
      halo_governance_note: halo.governance_note,

      shiftguard_status: shiftguard.status,
      shiftguard_mode: shiftguard.mode,
      shiftguard_execution_note: shiftguard.execution_note,

      status: "CREATED"
    }])
    .select();

  if (documentError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "documents insert failed",
        supabase_error: documentError.message,
        details: documentError
      }
    };
  }

  // =====================================================
  // INSERT RECIPIENT RECORD
  // =====================================================

  const { data: recipientData, error: recipientError } = await supabase
    .from("recipients")
    .insert([{
      proof_id,
      company_id: companyId,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      recipient_phone: recipientPhone,

      email_verification_status: recipientEmailVerification.status,
      email_verified_at: recipientEmailVerification.verified_at,
      phone_verification_status: senderPhoneVerification.status,
      phone_verified_at: senderPhoneVerification.verified_at,

      halo_status: halo.status,
      halo_risk_level: halo.risk_level,
      halo_confidence_score: halo.confidence_score,
      halo_governance_note: halo.governance_note,

      delivery_status: "PENDING",
      delivery_note: "API proof created. Delivery lifecycle pending."
    }])
    .select();

  if (recipientError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "recipients insert failed",
        supabase_error: recipientError.message,
        details: recipientError
      }
    };
  }

  // =====================================================
  // INSERT RECEIPT RECORD
  // =====================================================

  const { data: receiptData, error: receiptError } = await supabase
    .from("receipts")
    .insert([{
      proof_id,
      company_id: companyId,
      receipt_status: "GENERATED",
      receipt_note: "Verified proof receipt generated through VRI enterprise API"
    }])
    .select();

  if (receiptError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "receipts insert failed",
        supabase_error: receiptError.message,
        details: receiptError
      }
    };
  }

  // =====================================================
  // INSERT EXECUTION SESSION
  // =====================================================

  const { data: sessionData, error: sessionError } = await supabase
    .from("execution_sessions")
    .insert([
      {
        proof_id,
        execution_id,
        actor_name,
        department,
        action,
        risk_level: normalizedRisk,
        execution_state: shiftguard.execution_state
      }
    ])
    .select();

  if (sessionError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "execution_sessions insert failed",
        supabase_error: sessionError.message,
        details: sessionError
      }
    };
  }

  // =====================================================
  // INSERT VERIFICATION EVENTS
  // =====================================================

  const { data: eventData, error: eventError } = await supabase
    .from("verification_events")
    .insert([
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "API_PROOF_CREATED",
        status: "VERIFIED",
        event_note:
          "API proof created | Organization: " + organizationName +
          " | Industry: " + industry +
          " | Intent: " + verificationIntent
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "DOCUMENT_FINGERPRINT_CREATED",
        status: "VERIFIED",
        event_note:
          "API document fingerprint created using " + fingerprint.hash_algorithm +
          " | Hash Status: " + fingerprint.hash_status +
          " | Document Changed: " + fingerprint.document_changed +
          " | Hash Preview: " + fingerprint.document_hash.substring(0, 16) + "..."
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "AI_CONTENT_DISCLOSURE_RECORDED",
        status: "VERIFIED",
        event_note:
          "AI Used: " + aiDisclosure.ai_used +
          " | AI Tool: " + aiDisclosure.ai_tool_name +
          " | Human Reviewed: " + aiDisclosure.human_reviewed +
          " | AI Content Status: " + aiDisclosure.ai_content_status +
          " | Disclosure Note: " + aiDisclosure.ai_disclosure_note
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "API_VERIFICATION",
        status: shiftguard.execution_state,
        event_note:
          "API verification executed | Actor: " + cleanValue(actor_name, "N/A") +
          " | Department: " + cleanValue(department, "N/A") +
          " | Action: " + cleanValue(action, "N/A") +
          " | Risk Level: " + normalizedRisk +
          " | Execution State: " + shiftguard.execution_state
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "HALO_GOVERNANCE_CHECK",
        status: halo.risk_level,
        event_note:
          "HALO Status: " + halo.status +
          " | Risk: " + halo.risk_level +
          " | Confidence: " + halo.confidence_score +
          "% | Note: " + halo.governance_note
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "SHIFTGUARD_EXECUTION_READY",
        status: shiftguard.status,
        event_note:
          "ShiftGuard Clinical Status: " + shiftguard.status +
          " | Mode: " + shiftguard.mode +
          " | Supervisor Required: " + shiftguard.supervisor_required +
          " | Note: " + shiftguard.execution_note
      },
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "RECEIPT_GENERATED",
        status: "GENERATED",
        event_note: "Receipt generated for API-created proof record"
      }
    ])
    .select();

  if (eventError) {
    return {
      httpStatus: 500,
      body: {
        status: "ERROR",
        message: "verification_events insert failed",
        supabase_error: eventError.message,
        details: eventError
      }
    };
  }

  // =====================================================
  // INSERT ESCALATION RECORD IF REQUIRED
  // =====================================================

  let escalationData = null;

  if (shiftguard.supervisor_required) {
    const { data: savedEscalation, error: escalationError } = await supabase
      .from("execution_escalations")
      .insert([
        {
          proof_id,
          execution_id,
          actor_name,
          department,
          action,
          risk_level: normalizedRisk,
          escalation_status: "OPEN",
          supervisor_required: true
        }
      ])
      .select();

    if (escalationError) {
      return {
        httpStatus: 500,
        body: {
          status: "ERROR",
          message: "execution_escalations insert failed",
          supabase_error: escalationError.message,
          details: escalationError
        }
      };
    }

    escalationData = savedEscalation;

    await supabase
      .from("verification_events")
      .insert([{
        proof_id,
        execution_id,
        actor_name,
        event_type: "SUPERVISOR_OVERRIDE_REQUESTED",
        status: "PENDING",
        event_note:
          "Supervisor override requested by backend API" +
          " | Execution ID: " + execution_id +
          " | Action: " + cleanValue(action, "N/A") +
          " | Actor: " + cleanValue(actor_name, "N/A") +
          " | Risk Level: " + normalizedRisk
      }]);
  }

  // =====================================================
  // RETURN GOVERNED RESPONSE
  // =====================================================

  return {
    httpStatus: 200,
    body: {
      status: "VERIFIED",
      organization: validKey.organization_name,
      company_id: companyId,
      proof_id,
      execution_id,
      execution_state: shiftguard.execution_state,
      halo_status: halo.status,
      halo_risk_level: halo.risk_level,
      halo_confidence_score: halo.confidence_score,
      shiftguard_status: shiftguard.status,
      shiftguard_mode: shiftguard.mode,
      supervisor_required: shiftguard.supervisor_required,
      audit_locked: true,
      receipt_url: "/receipt.html?proof=" + encodeURIComponent(proof_id),
      public_verify_url: "/verify-proof.html?proof=" + encodeURIComponent(proof_id),
      database_writes: {
        proof_records: "SAVED",
        documents: "SAVED",
        recipients: "SAVED",
        receipts: "SAVED",
        execution_sessions: "SAVED",
        verification_events: "SAVED",
        execution_escalations: shiftguard.supervisor_required ? "SAVED" : "NOT_REQUIRED"
      },
      saved_records: {
        proof_record: proofRecordData,
        document: documentData,
        recipient: recipientData,
        receipt: receiptData,
        execution_session: sessionData,
        verification_events: eventData,
        escalation: escalationData
      }
    }
  };
}

// =====================================================
// VRI ENTERPRISE VERIFICATION API
// =====================================================

app.post("/api/vri/verify", async (req, res) => {
  try {
    const result = await runVriVerification(req.body);
    return res.status(result.httpStatus).json(result.body);
  } catch (error) {
    console.error("VRI API ERROR:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "VRI infrastructure failure",
      error: error.message
    });
  }
});

// =====================================================
// VRI AUDIT RETRIEVAL API
// =====================================================

app.get("/api/vri/audit/:proof_id", async (req, res) => {
  try {
    const { proof_id } = req.params;

    if (!proof_id) {
      return res.status(400).json({
        status: "ERROR",
        message: "Missing proof_id"
      });
    }

    const { data: proofRecord, error: proofError } = await supabase
      .from("proof_records")
      .select("*")
      .eq("proof_id", proof_id)
      .maybeSingle();

    if (proofError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load proof record",
        supabase_error: proofError.message
      });
    }

    const { data: documentRecord, error: documentError } = await supabase
      .from("documents")
      .select("*")
      .eq("proof_id", proof_id)
      .maybeSingle();

    if (documentError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load document record",
        supabase_error: documentError.message
      });
    }

    const { data: recipientRecord, error: recipientError } = await supabase
      .from("recipients")
      .select("*")
      .eq("proof_id", proof_id)
      .maybeSingle();

    if (recipientError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load recipient record",
        supabase_error: recipientError.message
      });
    }

    const { data: receiptRecord, error: receiptError } = await supabase
      .from("receipts")
      .select("*")
      .eq("proof_id", proof_id)
      .maybeSingle();

    if (receiptError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load receipt record",
        supabase_error: receiptError.message
      });
    }

    const { data: verificationEvents, error: verificationError } = await supabase
      .from("verification_events")
      .select("*")
      .eq("proof_id", proof_id)
      .order("created_at", { ascending: false });

    if (verificationError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load verification events",
        supabase_error: verificationError.message
      });
    }

    const { data: executionSessions, error: executionError } = await supabase
      .from("execution_sessions")
      .select("*")
      .eq("proof_id", proof_id)
      .order("execution_started_at", { ascending: false });

    if (executionError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load execution sessions",
        supabase_error: executionError.message
      });
    }

    const { data: escalations, error: escalationError } = await supabase
      .from("execution_escalations")
      .select("*")
      .eq("proof_id", proof_id)
      .order("created_at", { ascending: false });

    if (escalationError) {
      return res.status(500).json({
        status: "ERROR",
        message: "Failed to load escalation records",
        supabase_error: escalationError.message
      });
    }

    return res.json({
      status: "AUDIT_FOUND",
      proof_id,
      audit_locked: true,
      halo_status: proofRecord?.halo_status || "ACTIVE",
      proof_record: proofRecord,
      document_record: documentRecord,
      recipient_record: recipientRecord,
      receipt_record: receiptRecord,
      verification_events: verificationEvents || [],
      execution_sessions: executionSessions || [],
      escalations: escalations || [],
      audit_summary: {
        proof_record_found: Boolean(proofRecord),
        document_record_found: Boolean(documentRecord),
        recipient_record_found: Boolean(recipientRecord),
        receipt_record_found: Boolean(receiptRecord),
        verification_event_count: verificationEvents ? verificationEvents.length : 0,
        execution_session_count: executionSessions ? executionSessions.length : 0,
        escalation_count: escalations ? escalations.length : 0
      }
    });

  } catch (error) {
    console.error("VRI AUDIT API ERROR:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Audit retrieval failed",
      error: error.message
    });
  }
});

// =====================================================
// SIMULATION ROUTES
// =====================================================

app.get("/simulate/healthcare/high-risk-medication", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Nurse Olivia Carter",
      actor_email: "olivia.carter@example.com",
      actor_phone: "555-555-1001",
      department: "ICU",
      action: "High-Risk Medication Administration",
      risk_level: "HIGH",
      industry: "healthcare",
      business_name: "Healthcare System Demo",
      recipient_name: "Patient Record",
      recipient_email: "patientrecord@example.com",
      verification_intent: "Clinical Execution Governance",
      document_title: "High-Risk Medication Administration Proof",
      document_content: "A high-risk medication administration was submitted for VRI verification and ShiftGuard Clinical escalation."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "HEALTHCARE_HIGH_RISK_MEDICATION",
      environment: "ShiftGuard Clinical™",
      patient_state: "CRITICAL",
      supervisor_required: true,
      medication_classification: "CONTROLLED_SUBSTANCE",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Healthcare simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Healthcare simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/banking/high-risk-transfer", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Bank Officer Marcus Reed",
      actor_email: "marcus.reed@example.com",
      actor_phone: "555-555-2001",
      department: "Fraud Risk Operations",
      action: "High-Risk Wire Transfer Approval",
      risk_level: "HIGH",
      industry: "finance",
      business_name: "Apex Federal Bank",
      recipient_name: "Wire Transfer Review Desk",
      recipient_email: "reviewdesk@example.com",
      verification_intent: "Financial Risk Verification",
      document_title: "High-Risk Wire Transfer Proof",
      document_content: "A high-risk wire transfer approval request was submitted for VRI verification and supervisor escalation."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "BANKING_HIGH_RISK_TRANSFER",
      environment: "Financial Risk Verification",
      transaction_state: "FLAGGED_FOR_REVIEW",
      supervisor_required: true,
      risk_category: "WIRE_TRANSFER_AUTHORIZATION",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Banking simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Banking simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/legal/document-authorization", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Attorney Sophia Bennett",
      actor_email: "sophia.bennett@example.com",
      actor_phone: "555-555-3001",
      department: "Legal Compliance",
      action: "Legal Document Authorization",
      risk_level: "HIGH",
      industry: "legal",
      business_name: "Bennett Legal Compliance",
      recipient_name: "Legal Records Desk",
      recipient_email: "legalrecords@example.com",
      verification_intent: "Legal Proof",
      document_title: "Legal Document Authorization Proof",
      document_content: "A binding legal document authorization was submitted for VRI verification and authority review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "LEGAL_DOCUMENT_AUTHORIZATION",
      environment: "Legal Verification Infrastructure",
      document_state: "PENDING_FINAL_AUTHORITY",
      supervisor_required: true,
      legal_classification: "BINDING_EXECUTION_DOCUMENT",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Legal simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Legal simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/hr/employee-termination", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "HR Director Amanda Brooks",
      actor_email: "amanda.brooks@example.com",
      actor_phone: "555-555-4001",
      department: "Human Resources",
      action: "Employee Termination Authorization",
      risk_level: "HIGH",
      industry: "hr",
      business_name: "Enterprise Workforce Governance Demo",
      recipient_name: "HR Compliance Desk",
      recipient_email: "hrcompliance@example.com",
      verification_intent: "Internal Audit",
      document_title: "Employee Termination Authorization Proof",
      document_content: "An employee termination authorization was submitted for VRI verification and supervisor escalation."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "HR_EMPLOYEE_TERMINATION",
      environment: "Enterprise Workforce Governance",
      employee_status: "UNDER_REVIEW",
      supervisor_required: true,
      hr_classification: "TERMINATION_EXECUTION",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("HR simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "HR simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/ai-governance/model-execution", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "HALO Autonomous Governance Engine",
      actor_email: "halo@example.com",
      actor_phone: "555-555-5001",
      department: "AI Governance Division",
      action: "Autonomous AI Model Execution",
      risk_level: "HIGH",
      industry: "ai_governance",
      business_name: "HALO Governance Layer",
      recipient_name: "AI Governance Review Desk",
      recipient_email: "aigovernance@example.com",
      verification_intent: "AI Content Disclosure",
      document_title: "Autonomous AI Model Execution Proof",
      document_content: "An autonomous AI model execution was submitted for VRI verification, HALO governance, and ShiftGuard Clinical escalation.",
      ai_used: true,
      ai_tool_name: "HALO Autonomous Governance Engine",
      human_reviewed: false,
      ai_disclosure_note: "Autonomous AI execution was detected and requires human review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "HALO_AI_GOVERNANCE",
      environment: "HALO™ GOVERNANCE LAYER",
      ai_state: "EXECUTION_REVIEW_REQUIRED",
      supervisor_required: true,
      governance_classification: "AUTONOMOUS_DECISION_EXECUTION",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("AI governance simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "AI governance simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/government/contractor-compliance", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Compliance Officer Daniel Hayes",
      actor_email: "daniel.hayes@example.com",
      actor_phone: "555-555-6001",
      department: "Government Contractor Compliance",
      action: "Restricted Contract File Authorization",
      risk_level: "HIGH",
      industry: "government",
      business_name: "Contractor Risk & Compliance Demo",
      recipient_name: "Contract Review Desk",
      recipient_email: "contractreview@example.com",
      verification_intent: "Government Contractor Compliance",
      document_title: "Restricted Contract File Authorization Proof",
      document_content: "A restricted government contractor file authorization was submitted for VRI verification and supervisor escalation."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "GOVERNMENT_CONTRACTOR_COMPLIANCE",
      environment: "Contractor Risk & Compliance Infrastructure",
      contract_state: "RESTRICTED_REVIEW",
      supervisor_required: true,
      compliance_classification: "CONTROLLED_CONTRACT_AUTHORIZATION",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Government contractor simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Government contractor simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/identity/high-confidence-check", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Identity Verification Officer Maya Ellis",
      actor_email: "maya.ellis@example.com",
      actor_phone: "555-555-7001",
      department: "Identity Risk Operations",
      action: "High-Confidence Identity Verification",
      risk_level: "HIGH",
      industry: "identity",
      business_name: "VRI Identity Verification Layer",
      recipient_name: "Identity Review Desk",
      recipient_email: "identityreview@example.com",
      verification_intent: "Identity Confirmation",
      document_title: "High-Confidence Identity Verification Proof",
      document_content: "A high-confidence identity verification was submitted for VRI proof and risk review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "IDENTITY_HIGH_CONFIDENCE_CHECK",
      environment: "VRI™ Identity Verification Layer",
      identity_state: "VERIFICATION_REQUIRED",
      confidence_score: "92%",
      supervisor_required: true,
      identity_classification: "HIGH_CONFIDENCE_IDENTITY_REVIEW",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Identity verification simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Identity verification simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/biometric/execution-checkpoint", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Badge + Biometric Checkpoint",
      actor_email: "checkpoint@example.com",
      actor_phone: "555-555-8001",
      department: "Secure Access Control",
      action: "Biometric Execution Checkpoint Verification",
      risk_level: "HIGH",
      industry: "biometric",
      business_name: "VRI Biometric Verification Layer",
      recipient_name: "Secure Access Review Desk",
      recipient_email: "accessreview@example.com",
      verification_intent: "Identity Confirmation",
      document_title: "Biometric Execution Checkpoint Proof",
      document_content: "A badge and biometric execution checkpoint verification was submitted for VRI proof and escalation."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "BIOMETRIC_EXECUTION_CHECKPOINT",
      environment: "VRI™ Biometric Verification Layer",
      biometric_state: "MATCH_REQUIRED",
      badge_verified: true,
      facial_match_score: "94%",
      fingerprint_match_score: "97%",
      supervisor_required: true,
      biometric_classification: "BADGE_BIOMETRIC_PAIRING",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Biometric checkpoint simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Biometric checkpoint simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/audit/immutable-lock", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "VRI Audit Lock Engine",
      actor_email: "auditlock@example.com",
      actor_phone: "555-555-9001",
      department: "Immutable Audit Infrastructure",
      action: "Immutable Audit Record Lock",
      risk_level: "HIGH",
      industry: "audit",
      business_name: "VRI Audit Infrastructure",
      recipient_name: "Audit Review Desk",
      recipient_email: "auditreview@example.com",
      verification_intent: "Immutable Audit",
      document_title: "Immutable Audit Record Lock Proof",
      document_content: "An immutable audit lock event was submitted for VRI verification and authority review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "IMMUTABLE_AUDIT_LOCK",
      environment: "VRI™ Audit Infrastructure",
      audit_state: "LOCKED",
      modification_allowed: false,
      supervisor_required: true,
      audit_classification: "IMMUTABLE_PROOF_RECORD",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Immutable audit lock simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Immutable audit lock simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/executive/authority-override", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Executive Authority Board",
      actor_email: "executiveboard@example.com",
      actor_phone: "555-555-9101",
      department: "Executive Governance",
      action: "Executive-Level Override Authorization",
      risk_level: "HIGH",
      industry: "executive",
      business_name: "Enterprise Executive Governance",
      recipient_name: "Executive Review Desk",
      recipient_email: "executivereview@example.com",
      verification_intent: "Executive Authority",
      document_title: "Executive-Level Override Authorization Proof",
      document_content: "An executive-level override authorization was submitted for VRI verification and multi-level review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "EXECUTIVE_AUTHORITY_OVERRIDE",
      environment: "Enterprise Executive Governance",
      authority_state: "MULTI_LEVEL_REVIEW_REQUIRED",
      executive_approval_required: true,
      supervisor_required: true,
      authority_classification: "EXECUTIVE_OVERRIDE_CHAIN",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Executive authority simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Executive authority simulation failed",
      error: error.message
    });
  }
});

app.get("/simulate/escalation/multi-supervisor-chain", async (req, res) => {
  try {
    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Regional Operations Supervisor",
      actor_email: "regional.supervisor@example.com",
      actor_phone: "555-555-9201",
      department: "Enterprise Escalation Operations",
      action: "Multi-Supervisor Escalation Chain Activation",
      risk_level: "HIGH",
      industry: "enterprise",
      business_name: "VRI Escalation Infrastructure",
      recipient_name: "Escalation Review Desk",
      recipient_email: "escalationreview@example.com",
      verification_intent: "Multi-Supervisor Escalation",
      document_title: "Multi-Supervisor Escalation Chain Proof",
      document_content: "A multi-supervisor escalation chain was submitted for VRI verification and level-three authority review."
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "MULTI_SUPERVISOR_ESCALATION_CHAIN",
      environment: "VRI™ Escalation Infrastructure",
      escalation_state: "LEVEL_3_ESCALATION_ACTIVE",
      escalation_chain: [
        "Supervisor Level 1",
        "Regional Director",
        "Executive Governance Board"
      ],
      supervisor_required: true,
      escalation_classification: "CHAINED_ENTERPRISE_ESCALATION",
      timestamp: new Date().toISOString(),
      vri_response: result.body
    });

  } catch (error) {
    console.error("Multi-supervisor escalation simulation error:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "Multi-supervisor escalation failed",
      error: error.message
    });
  }
});

// =====================================================
// BROWSER TEST ROUTE
// =====================================================

app.get("/test-vri", async (req, res) => {
  try {
    const testPayload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "VRI API Test Actor",
      actor_email: "api.test@example.com",
      actor_phone: "555-555-0000",
      department: "API Testing",
      action: "Full API Proof Flow Test",
      risk_level: "HIGH",
      industry: "enterprise",
      business_name: "VRI API Test Company",
      recipient_name: "API Test Recipient",
      recipient_email: "recipient.test@example.com",
      verification_intent: "API Full Flow Verification",
      document_title: "Full API Proof Flow Test",
      document_content: "This is a full backend API test that should create proof_records, documents, recipients, receipts, verification_events, execution_sessions, and execution_escalations.",
      ai_used: true,
      ai_tool_name: "VRI API Test Generator",
      human_reviewed: true,
      ai_disclosure_note: "AI disclosure added for API test flow."
    };

    const result = await runVriVerification(testPayload);
    return res.status(result.httpStatus).json(result.body);

  } catch (error) {
    console.error("TEST VRI ERROR:", error);

    return res.status(500).json({
      status: "FAILED",
      message: "Test route failed",
      error: error.message
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`VRI API infrastructure running on port ${PORT}`);
});
