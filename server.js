const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(cors());
app.use(express.json());

// =====================================================
// SUPABASE CONNECTION
// =====================================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// =====================================================
// HEALTH CHECK
// =====================================================

app.get("/", (req, res) => {
  res.json({
    system: "VRI Verification & Risk Infrastructure",
    status: "ONLINE",
    halo: "ACTIVE",
    shiftguard: "CONNECTED"
  });
});

// =====================================================
// VRI ENTERPRISE VERIFICATION API
// =====================================================

app.post("/api/vri/verify", async (req, res) => {
  try {
    const {
      api_key,
      actor_name,
      department,
      action,
      risk_level
    } = req.body;

    if (!api_key) {
      return res.status(401).json({
        status: "DENIED",
        message: "Missing API key"
      });
    }

    const { data: validKey, error: keyError } = await supabase
      .from("api_keys")
      .select("*")
      .eq("api_key", api_key)
      .eq("status", "ACTIVE")
      .single();

    if (keyError || !validKey) {
      return res.status(401).json({
        status: "DENIED",
        message: "Invalid or inactive API key"
      });
    }

    const proof_id = "VRI-" + Date.now();
    const execution_id = "EXEC-" + Date.now();

    let execution_state = "APPROVED";
    let supervisor_required = false;

    if ((risk_level || "").toUpperCase() === "HIGH") {
      execution_state = "ESCALATED";
      supervisor_required = true;
    }

    await supabase.from("execution_sessions").insert([
      {
        execution_id,
        actor_name,
        department,
        action,
        risk_level,
        execution_state
      }
    ]);

    await supabase.from("verification_events").insert([
      {
        proof_id,
        execution_id,
        actor_name,
        event_type: "API_VERIFICATION",
        status: execution_state
      }
    ]);

    return res.json({
      status: "VERIFIED",
      organization: validKey.organization_name,
      proof_id,
      execution_id,
      execution_state,
      halo_status: "ACTIVE",
      supervisor_required,
      audit_locked: true
    });

  } catch (error) {
    console.error("VRI API ERROR:", error);

    return res.status(500).json({
      status: "ERROR",
      message: "VRI infrastructure failure"
    });
  }
});

// =====================================================
// START SERVER
// =====================================================

app.get("/test-vri", async (req, res) => {
  const testPayload = {
    api_key: "VRI_TEST_KEY_001",
    actor_name: "Nurse A",
    department: "ICU",
    action: "Controlled Medication Override",
    risk_level: "HIGH"
  };

  try {
    const response = await fetch(`http://localhost:${PORT}/api/vri/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(testPayload)
    });

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "FAILED",
      message: "Test route failed"
    });
  }
});
const PORT = process.env.PORT || 3000;

app.get("/test-vri", async (req, res) => {
  const testPayload = {
    api_key: "VRI_TEST_KEY_001",
    actor_name: "Nurse A",
    department: "ICU",
    action: "Controlled Medication Override",
    risk_level: "HIGH"
  };

  try {
    const response = await fetch(`http://localhost:${PORT}/api/vri/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(testPayload)
    });

    const data = await response.json();
    res.json(data);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      status: "FAILED",
      message: "Test route failed"
    });
  }
});

app.listen(PORT, () => {
  console.log(`VRI API infrastructure running on port ${PORT}`);
});
