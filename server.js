app.post("/api/vri/verify", async (req, res) => {
  try {

    const {
      api_key,
      actor_name,
      department,
      action,
      risk_level
    } = req.body;

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
      return res.status(401).json({
        status: "DENIED",
        message: "Invalid API Key"
      });
    }

    // =====================================================
    // GENERATE IDS
    // =====================================================

    const proof_id =
      "VRI-" + Math.floor(100000 + Math.random() * 900000);

    const execution_id =
      "EXEC-" + Math.floor(100000 + Math.random() * 900000);

    // =====================================================
    // HALO GOVERNANCE LOGIC
    // =====================================================

    let execution_state = "APPROVED";
    let halo_status = "ACTIVE";
    let supervisor_required = false;

    if (risk_level === "HIGH") {
      execution_state = "ESCALATED";
      supervisor_required = true;
    }

    // =====================================================
    // CREATE EXECUTION SESSION
    // =====================================================

    await supabase
      .from("execution_sessions")
      .insert([
        {
          execution_id,
          actor_name,
          department,
          action,
          risk_level,
          execution_state
        }
      ]);

    // =====================================================
    // CREATE VERIFICATION EVENT
    // =====================================================

    await supabase
      .from("verification_events")
      .insert([
        {
          proof_id,
          execution_id,
          actor_name,
          event_type: "API_VERIFICATION",
          status: execution_state
        }
      ]);

    // =====================================================
    // RETURN GOVERNED RESPONSE
    // =====================================================

    return res.json({
      status: "VERIFIED",
      organization: validKey.organization_name,
      proof_id,
      execution_id,
      execution_state,
      halo_status,
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
