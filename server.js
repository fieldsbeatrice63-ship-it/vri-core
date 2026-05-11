const express = require("express");
const cors = require("cors");
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
  // GENERATE IDS
  // =====================================================

  const timestamp = Date.now();
  const proof_id = "VRI-" + timestamp;
  const execution_id = "EXEC-" + timestamp;

  // =====================================================
  // HALO GOVERNANCE LOGIC
  // =====================================================

  const normalizedRisk = (risk_level || "").toUpperCase();

  let execution_state = "APPROVED";
  let supervisor_required = false;

  if (normalizedRisk === "HIGH") {
    execution_state = "ESCALATED";
    supervisor_required = true;
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
        execution_state
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
  // INSERT VERIFICATION EVENT
  // =====================================================

  const { data: eventData, error: eventError } = await supabase
    .from("verification_events")
    .insert([
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "API_VERIFICATION",
        status: execution_state
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

  if (execution_state === "ESCALATED") {
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
  }

  // =====================================================
  // RETURN GOVERNED RESPONSE
  // =====================================================

  return {
    httpStatus: 200,
    body: {
      status: "VERIFIED",
      organization: validKey.organization_name,
      proof_id,
      execution_id,
      execution_state,
      halo_status: "ACTIVE",
      supervisor_required,
      audit_locked: true,
     database_writes: {
  execution_sessions: "SAVED",
  verification_events: "SAVED",
  execution_escalations:
    execution_state === "ESCALATED"
      ? "SAVED"
      : "NOT_REQUIRED"
},

saved_records: {
  execution_session: sessionData,
  verification_event: eventData,
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
      halo_status: "ACTIVE",
      verification_events: verificationEvents || [],
      execution_sessions: executionSessions || [],
      escalations: escalations || [],
      audit_summary: {
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
// HEALTHCARE ENTERPRISE SIMULATION
// =====================================================

app.get("/simulate/healthcare/high-risk-medication", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Nurse Olivia Carter",
      department: "ICU",
      action: "High-Risk Medication Administration",
      risk_level: "HIGH"
    };

    const result = await runVriVerification(payload);

    return res.status(result.httpStatus).json({
      simulation: "HEALTHCARE_HIGH_RISK_MEDICATION",
      environment: "SHIFTGuard Clinical™",
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

// =====================================================
// BANKING ENTERPRISE SIMULATION
// =====================================================

app.get("/simulate/banking/high-risk-transfer", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Bank Officer Marcus Reed",
      department: "Fraud Risk Operations",
      action: "High-Risk Wire Transfer Approval",
      risk_level: "HIGH"
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
// =====================================================
// LEGAL ENTERPRISE SIMULATION
// =====================================================

app.get("/simulate/legal/document-authorization", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Attorney Sophia Bennett",
      department: "Legal Compliance",
      action: "Legal Document Authorization",
      risk_level: "HIGH"
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

// =====================================================
// HR ENTERPRISE SIMULATION
// =====================================================

app.get("/simulate/hr/employee-termination", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "HR Director Amanda Brooks",
      department: "Human Resources",
      action: "Employee Termination Authorization",
      risk_level: "HIGH"
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

// =====================================================
// AI GOVERNANCE SIMULATION
// =====================================================

app.get("/simulate/ai-governance/model-execution", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "HALO Autonomous Governance Engine",
      department: "AI Governance Division",
      action: "Autonomous AI Model Execution",
      risk_level: "HIGH"
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
// =====================================================
// GOVERNMENT CONTRACTOR SIMULATION
// =====================================================

app.get("/simulate/government/contractor-compliance", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Compliance Officer Daniel Hayes",
      department: "Government Contractor Compliance",
      action: "Restricted Contract File Authorization",
      risk_level: "HIGH"
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
// =====================================================
// IDENTITY VERIFICATION SIMULATION
// =====================================================

app.get("/simulate/identity/high-confidence-check", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Identity Verification Officer Maya Ellis",
      department: "Identity Risk Operations",
      action: "High-Confidence Identity Verification",
      risk_level: "HIGH"
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
// =====================================================
// BIOMETRIC CHECKPOINT SIMULATION
// =====================================================

app.get("/simulate/biometric/execution-checkpoint", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Badge + Biometric Checkpoint",
      department: "Secure Access Control",
      action: "Biometric Execution Checkpoint Verification",
      risk_level: "HIGH"
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
// =====================================================
// IMMUTABLE AUDIT LOCK SIMULATION
// =====================================================

app.get("/simulate/audit/immutable-lock", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "VRI Audit Lock Engine",
      department: "Immutable Audit Infrastructure",
      action: "Immutable Audit Record Lock",
      risk_level: "HIGH"
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
// =====================================================
// EXECUTIVE AUTHORITY SIMULATION
// =====================================================

app.get("/simulate/executive/authority-override", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Executive Authority Board",
      department: "Executive Governance",
      action: "Executive-Level Override Authorization",
      risk_level: "HIGH"
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
// =====================================================
// MULTI-SUPERVISOR ESCALATION CHAIN SIMULATION
// =====================================================

app.get("/simulate/escalation/multi-supervisor-chain", async (req, res) => {

  try {

    const payload = {
      api_key: "VRI_TEST_KEY_001",
      actor_name: "Regional Operations Supervisor",
      department: "Enterprise Escalation Operations",
      action: "Multi-Supervisor Escalation Chain Activation",
      risk_level: "HIGH"
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
      message: "Multi-supervisor escalation simulation failed",
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
      actor_name: "Nurse A",
      department: "ICU",
      action: "Controlled Medication Override",
      risk_level: "HIGH"
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
