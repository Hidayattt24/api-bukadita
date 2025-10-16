const { success, failure } = require("../utils/respond");

// ============================================================================
// Helper Function: Recalculate Module Progress
// ============================================================================
async function recalculateModuleProgress(supabase, userId, moduleId) {
  try {
    console.log("📊 [Helper] Recalculating module progress:", {
      userId,
      moduleId,
    });

    // Get all sub-materi progress for this module
    const { data: allSubMateriProgress, error: fetchError } = await supabase
      .from("user_sub_materi_progress_simple")
      .select("*")
      .eq("user_id", userId)
      .eq("module_id", moduleId);

    if (fetchError) {
      console.error("Error fetching sub-materi progress:", fetchError);
      return { success: false, error: fetchError };
    }

    if (!allSubMateriProgress || allSubMateriProgress.length === 0) {
      console.log("No sub-materi progress found, setting module to 0%");

      // Create initial module progress record
      const { error: initError } = await supabase
        .from("user_module_progress_simple")
        .upsert(
          {
            user_id: userId,
            module_id: moduleId,
            progress_percentage: 0,
            is_completed: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,module_id" }
        );

      if (initError) {
        console.error("Error initializing module progress:", initError);
        return { success: false, error: initError };
      }

      return { success: true, progress: 0, completed: false };
    }

    // Calculate average progress
    const totalProgress = allSubMateriProgress.reduce(
      (sum, sub) => sum + (sub.progress_percentage || 0),
      0
    );
    const averageProgress = totalProgress / allSubMateriProgress.length;

    // Check if all sub-materis are completed
    const allCompleted = allSubMateriProgress.every(
      (sub) => sub.is_completed === true
    );

    const moduleProgressPercentage = Math.round(averageProgress * 100) / 100;

    console.log("📈 [Helper] Module progress calculated:", {
      totalSubMateris: allSubMateriProgress.length,
      completedCount: allSubMateriProgress.filter((s) => s.is_completed).length,
      averageProgress: moduleProgressPercentage,
      allCompleted,
    });

    // Update module progress
    const { data: moduleProgressData, error: updateError } = await supabase
      .from("user_module_progress_simple")
      .upsert(
        {
          user_id: userId,
          module_id: moduleId,
          progress_percentage: moduleProgressPercentage,
          is_completed: allCompleted,
          completed_at: allCompleted ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,module_id" }
      )
      .select()
      .single();

    if (updateError) {
      console.error("Error updating module progress:", updateError);
      return { success: false, error: updateError };
    }

    console.log("✅ [Helper] Module progress updated:", {
      progress: moduleProgressPercentage,
      completed: allCompleted,
    });

    return {
      success: true,
      progress: moduleProgressPercentage,
      completed: allCompleted,
      data: moduleProgressData,
    };
  } catch (error) {
    console.error("Exception in recalculateModuleProgress:", error);
    return { success: false, error };
  }
}

// Menandai poin sebagai selesai
// POST /api/v1/progress/materials/:materi_id/poins/:poin_id/complete
// Body: { module_id: number } - required for grouping
async function completePoin(req, res) {
  try {
    const { materi_id, poin_id } = req.params;
    const { module_id } = req.body; // Get module_id from request body
    const userId = req.user.id;

    // Validate module_id
    if (!module_id) {
      return failure(
        res,
        "MISSING_MODULE_ID",
        "module_id is required in request body",
        400
      );
    }

    // IMPORTANT: Frontend has static poin data (dummy data)
    // Backend only tracks completion, does NOT validate poin existence
    // Frontend is responsible for sending valid poin_id and materi_id

    console.log("DEBUG: Completing poin:", {
      userId,
      module_id,
      materi_id,
      poin_id,
    });

    // Cek apakah sudah completed sebelumnya
    const { data: existingProgress } = await req.supabase
      .from("user_poin_progress_simple")
      .select("id, is_completed")
      .eq("user_id", userId)
      .eq("poin_id", poin_id)
      .maybeSingle();

    if (existingProgress?.is_completed) {
      console.log("DEBUG: Poin already completed");
      return success(
        res,
        "POIN_ALREADY_COMPLETED",
        "Poin sudah diselesaikan sebelumnya",
        existingProgress
      );
    }

    // Tandai poin sebagai selesai
    // Note: No validation against poin_details table
    // Frontend static data is the source of truth
    const { data: progress, error: progressError } = await req.supabase
      .from("user_poin_progress_simple")
      .upsert(
        {
          user_id: userId,
          module_id: parseInt(module_id),
          sub_materi_id: materi_id,
          poin_id,
          is_completed: true,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,poin_id", // Specify unique constraint columns
        }
      )
      .select()
      .single();

    if (progressError) {
      console.error("DEBUG: Error saving poin progress:", progressError);
      return failure(
        res,
        "POIN_PROGRESS_ERROR",
        "Gagal menyimpan progress poin",
        500,
        {
          details: progressError.message,
        }
      );
    }

    console.log("DEBUG: Poin completed successfully:", progress);

    // Update progress sub_materi after completing poin
    await updateSubMateriProgress(req.supabase, userId, materi_id, module_id);

    // 🔥 CRITICAL: Recalculate module progress after poin completion
    await recalculateModuleProgress(req.supabase, userId, parseInt(module_id));

    return success(
      res,
      "POIN_COMPLETED",
      "Poin berhasil diselesaikan",
      progress
    );
  } catch (error) {
    console.error("Complete poin error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// Helper function untuk update progress sub_materi
// SIMPLIFIED: Backend only updates records, does NOT calculate from database
// Frontend is responsible for determining completion status and progress percentage
async function updateSubMateriProgress(
  supabase,
  userId,
  subMateriId,
  moduleId
) {
  try {
    console.log("DEBUG: Updating sub-materi progress:", {
      userId,
      moduleId,
      subMateriId,
    });

    // Get all completed poins for this sub-materi
    const { data: completedPoins } = await supabase
      .from("user_poin_progress_simple")
      .select("poin_id")
      .eq("user_id", userId)
      .eq("sub_materi_id", subMateriId)
      .eq("is_completed", true);

    const completedCount = completedPoins?.length || 0;

    console.log("DEBUG: Completed poins count:", completedCount);

    // Note: We don't know total poins from database
    // Progress percentage will be calculated when frontend explicitly calls
    // the completeSubMateri endpoint after all poins are done

    // Just update the last_accessed timestamp
    const { error: updateError } = await supabase
      .from("user_sub_materi_progress_simple")
      .upsert(
        {
          user_id: userId,
          module_id: parseInt(moduleId),
          sub_materi_id: subMateriId,
          is_completed: false, // Will be set to true by completeSubMateri
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,sub_materi_id",
        }
      );

    if (updateError) {
      console.error("DEBUG: Error updating sub-materi progress:", updateError);
    } else {
      console.log("DEBUG: Sub-materi progress updated successfully");
    }
  } catch (error) {
    console.error("Update sub materi progress error:", error);
  }
}

// Helper function untuk update progress module (SIMPLIFIED)
// Frontend is responsible for calculating and sending progress percentage
async function updateModuleProgressSimple(supabase, userId, moduleId) {
  try {
    console.log("DEBUG: Updating module progress (simple):", {
      userId,
      moduleId,
    });

    // Get all completed sub-materis for this module
    const { data: completedSubMateris } = await supabase
      .from("user_sub_materi_progress_simple")
      .select("sub_materi_id, is_completed")
      .eq("user_id", userId)
      .eq("module_id", parseInt(moduleId))
      .eq("is_completed", true);

    const completedCount = completedSubMateris?.length || 0;

    console.log("DEBUG: Completed sub-materis count:", completedCount);

    // Note: We don't know total sub-materis from database
    // Progress percentage should be calculated and sent by frontend
    // For now, just update the last_accessed timestamp

    const { error: updateError } = await supabase
      .from("user_module_progress_simple")
      .upsert(
        {
          user_id: userId,
          module_id: parseInt(moduleId),
          updated_at: new Date().toISOString(),
          // Frontend will update progress_percentage and completed status
          // when it knows all sub-materis are done
        },
        {
          onConflict: "user_id,module_id",
        }
      );

    if (updateError) {
      console.error("DEBUG: Error updating module progress:", updateError);
    } else {
      console.log("DEBUG: Module progress updated successfully");
    }
  } catch (error) {
    console.error("Update module progress error:", error);
  }
}

// OLD Helper function (kept for reference, now deprecated)
async function updateModuleProgress(supabase, userId, moduleId) {
  try {
    // Hitung total sub_materi dan yang sudah selesai
    const { data: allSubMateris } = await supabase
      .from("sub_materis")
      .select("id")
      .eq("module_id", moduleId)
      .eq("published", true);

    const { data: completedSubMateris } = await supabase
      .from("user_sub_materi_progress")
      .select("sub_materi_id")
      .eq("user_id", userId)
      .eq("completed", true)
      .in("sub_materi_id", allSubMateris?.map((s) => s.id) || []);

    const totalSubMateris = allSubMateris?.length || 0;
    const completedCount = completedSubMateris?.length || 0;
    const allSubMaterisCompleted =
      totalSubMateris > 0 && completedCount === totalSubMateris;

    // Get all sub-materi progress to calculate average
    const { data: allProgress } = await supabase
      .from("user_sub_materi_progress")
      .select("progress_percentage")
      .eq("user_id", userId)
      .in("sub_materi_id", allSubMateris?.map((s) => s.id) || []);

    // Calculate module progress as average of all sub-materi progress
    let moduleProgressPercentage = 0;
    if (allProgress && allProgress.length > 0) {
      const totalProgress = allProgress.reduce(
        (sum, p) => sum + (p.progress_percentage || 0),
        0
      );
      moduleProgressPercentage = Math.round(totalProgress / totalSubMateris);
    } else if (totalSubMateris > 0) {
      // If no progress yet but user has accessed the module, show initial progress
      moduleProgressPercentage = Math.round((1 / (totalSubMateris + 1)) * 100);
    }

    // Update progress module
    await supabase.from("user_module_progress").upsert({
      user_id: userId,
      module_id: moduleId,
      is_completed: allSubMaterisCompleted,
      completed_at: allSubMaterisCompleted ? new Date().toISOString() : null,
      progress_percentage: moduleProgressPercentage,
    });
  } catch (error) {
    console.error("Update module progress error:", error);
  }
}

// Mendapatkan progress user untuk sebuah module
// GET /api/v1/progress/modules/:module_id
async function getModuleProgress(req, res) {
  try {
    const { module_id } = req.params;
    const userId = req.user.id;

    // IMPORTANT: Frontend has static module/sub-materi/poin data
    // Backend only returns progress tracking data

    console.log("DEBUG: Fetching progress for module:", {
      userId,
      module_id,
    });

    // Get module progress
    const { data: moduleProgress, error: moduleError } = await req.supabase
      .from("user_module_progress_simple")
      .select("*")
      .eq("user_id", userId)
      .eq("module_id", parseInt(module_id))
      .maybeSingle();

    if (moduleError) {
      console.error("DEBUG: Module progress error:", moduleError);
      return failure(
        res,
        "MODULE_PROGRESS_ERROR",
        "Gagal mengambil progress module",
        500,
        {
          details: moduleError.message,
        }
      );
    }

    // Get all sub-materi progress for this module
    const { data: subMateriProgress, error: subMateriError } =
      await req.supabase
        .from("user_sub_materi_progress_simple")
        .select("*")
        .eq("user_id", userId)
        .eq("module_id", parseInt(module_id))
        .order("created_at", { ascending: true });

    if (subMateriError) {
      console.error("DEBUG: Sub-materi progress error:", subMateriError);
    }

    // Get all poin progress for this module
    const { data: poinProgress, error: poinError } = await req.supabase
      .from("user_poin_progress_simple")
      .select("*")
      .eq("user_id", userId)
      .eq("module_id", parseInt(module_id))
      .order("created_at", { ascending: true });

    if (poinError) {
      console.error("DEBUG: Poin progress error:", poinError);
    }

    // Return raw progress data
    // Frontend will match this with its static content
    return success(
      res,
      "MODULE_PROGRESS_SUCCESS",
      "Progress module berhasil diambil",
      {
        module_progress: moduleProgress || {
          module_id: parseInt(module_id),
          is_completed: false,
          progress_percentage: 0,
        },
        sub_materi_progress: subMateriProgress || [],
        poin_progress: poinProgress || [],
      }
    );
  } catch (error) {
    console.error("Get module progress error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// Mendapatkan daftar progress semua module untuk user
// GET /api/v1/progress/modules
async function getUserModulesProgress(req, res) {
  try {
    const userId = req.user.id;

    // IMPORTANT: Frontend has static module data (dummy data)
    // Backend only tracks user progress, NOT module content

    console.log("DEBUG: Fetching progress for user:", userId);

    // 🔥 FIX: Get all user's module progress records first
    const { data: moduleProgress, error: progressError } = await req.supabase
      .from("user_module_progress_simple")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    console.log("DEBUG: Module progress query result:", {
      records: moduleProgress?.length,
      error: progressError?.message,
    });

    if (progressError) {
      return failure(
        res,
        "PROGRESS_FETCH_ERROR",
        "Gagal mengambil progress modules",
        500,
        {
          details: progressError.message,
        }
      );
    }

    // 🔥 NEW: Recalculate progress for each module to ensure accuracy
    if (moduleProgress && moduleProgress.length > 0) {
      console.log(
        `[getUserModulesProgress] Recalculating progress for ${moduleProgress.length} modules...`
      );

      for (const module of moduleProgress) {
        await recalculateModuleProgress(req.supabase, userId, module.module_id);
      }

      // 🔥 Fetch updated progress after recalculation
      const { data: updatedProgress, error: refetchError } = await req.supabase
        .from("user_module_progress_simple")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (refetchError) {
        console.error(
          "[getUserModulesProgress] Error refetching after recalculate:",
          refetchError
        );
        // Continue with old data instead of failing
      } else {
        console.log(
          "[getUserModulesProgress] Successfully recalculated all module progress"
        );
        // Use updated progress data
        const progressData =
          updatedProgress?.map((progress) => ({
            id: progress.module_id, // Module ID untuk match dengan frontend
            module_id: progress.module_id,
            progress_percentage: progress.progress_percentage || 0,
            completed: progress.is_completed || false,
            updated_at: progress.updated_at,
            created_at: progress.created_at,
            completed_at: progress.completed_at,
          })) || [];

        // Set no-cache headers for fresh progress data
        res.set({
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        });

        return success(
          res,
          "USER_MODULES_PROGRESS_SUCCESS",
          "Progress modules berhasil diambil",
          {
            modules: progressData,
          }
        );
      }
    }

    // Return only progress data (fallback if no recalculation)
    // Frontend will match this with its static module data by module_id
    const progressData =
      moduleProgress?.map((progress) => ({
        id: progress.module_id, // Module ID untuk match dengan frontend
        module_id: progress.module_id,
        progress_percentage: progress.progress_percentage || 0,
        completed: progress.is_completed || false,
        updated_at: progress.updated_at,
        created_at: progress.created_at,
        completed_at: progress.completed_at,
      })) || [];

    // Set no-cache headers for fresh progress data
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    });

    return success(
      res,
      "USER_MODULES_PROGRESS_SUCCESS",
      "Progress modules berhasil diambil",
      {
        modules: progressData,
      }
    );
  } catch (error) {
    console.error("Get user modules progress error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// Cek apakah user dapat akses sub_materi tertentu berdasarkan progress
// GET /api/v1/progress/materials/:sub_materi_id/access
async function checkSubMateriAccess(req, res) {
  try {
    const { sub_materi_id } = req.params;
    const userId = req.user.id;

    // Get sub_materi info
    const { data: subMateri, error: subMateriError } = await req.supabase
      .from("sub_materis")
      .select("id, module_id, order_index")
      .eq("id", sub_materi_id)
      .eq("published", true)
      .single();

    if (subMateriError || !subMateri) {
      return failure(
        res,
        "SUB_MATERI_NOT_FOUND",
        "Sub materi tidak ditemukan",
        404
      );
    }

    // Get previous sub_materi in the same module
    const { data: previousSubMateris } = await req.supabase
      .from("sub_materis")
      .select("id")
      .eq("module_id", subMateri.module_id)
      .eq("published", true)
      .lt("order_index", subMateri.order_index);

    let canAccess = true;
    let reason = "";

    // Jika ada sub_materi sebelumnya, cek apakah sudah selesai semua
    if (previousSubMateris && previousSubMateris.length > 0) {
      const { data: completedPrevious } = await req.supabase
        .from("user_sub_materi_progress")
        .select("sub_materi_id")
        .eq("user_id", userId)
        .eq("completed", true)
        .in(
          "sub_materi_id",
          previousSubMateris.map((s) => s.id)
        );

      const completedCount = completedPrevious?.length || 0;
      const requiredCount = previousSubMateris.length;

      if (completedCount < requiredCount) {
        canAccess = false;
        reason = `Selesaikan ${
          requiredCount - completedCount
        } materi sebelumnya terlebih dahulu`;
      }
    }

    return success(
      res,
      "SUB_MATERI_ACCESS_CHECK",
      "Pengecekan akses berhasil",
      {
        can_access: canAccess,
        reason: reason,
        sub_materi_id: sub_materi_id,
      }
    );
  } catch (error) {
    console.error("Check sub materi access error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// GET /api/v1/progress/sub-materis/:id - Mendapatkan progress user untuk sub materi tertentu
const getSubMateriProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    console.log(
      `[Progress API] Fetching progress for user ${userId}, sub_materi ${id}`
    );

    // Get sub_materi info first
    const { data: subMateri, error: subMateriError } = await req.supabase
      .from("sub_materis")
      .select("id, title, module_id, published")
      .eq("id", id)
      .single();

    if (subMateriError || !subMateri) {
      console.error("[Progress API] Sub materi not found:", subMateriError);
      return failure(
        res,
        "SUB_MATERI_NOT_FOUND",
        "Sub materi tidak ditemukan",
        404
      );
    }

    // Check if sub materi is published (non-admin users)
    const isAdmin =
      req.profile && ["admin", "superadmin"].includes(req.profile.role);
    if (!subMateri.published && !isAdmin) {
      return failure(
        res,
        "SUB_MATERI_NOT_PUBLISHED",
        "Sub materi belum dipublikasi",
        403
      );
    }

    // Get or create user progress for this sub_materi
    let { data: progressRecord, error: progressError } = await req.supabase
      .from("user_sub_materi_progress")
      .select("*")
      .eq("user_id", userId)
      .eq("sub_materi_id", id)
      .maybeSingle();

    if (progressError) {
      console.error("[Progress API] Error fetching progress:", progressError);
      return failure(
        res,
        "PROGRESS_FETCH_ERROR",
        "Gagal mengambil progress",
        500,
        { details: progressError.message }
      );
    }

    // Create initial progress record if not exists
    if (!progressRecord) {
      console.log(
        `[Progress API] Creating initial progress record for user ${userId}, sub_materi ${id}`
      );

      // Get total poin untuk menghitung initial progress
      const { data: allPoin } = await req.supabase
        .from("poin_details")
        .select("id")
        .eq("sub_materi_id", id);

      const totalPoin = allPoin?.length || 0;

      // Set initial progress: jika ada poin, progress dimulai dari 1/totalPoin
      // Ini memastikan progress tidak 0% saat user pertama kali membuka
      const initialProgress =
        totalPoin > 0 ? Math.round((1 / (totalPoin + 1)) * 100) : 5;

      const { data: newProgress, error: createError } = await req.supabase
        .from("user_sub_materi_progress")
        .insert({
          user_id: userId,
          sub_materi_id: id,
          is_unlocked: true,
          is_completed: false,
          current_poin_index: 0,
          progress_percent: initialProgress,
          last_accessed_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (createError) {
        console.error("[Progress API] Error creating progress:", createError);
        // Return default progress if creation fails
        progressRecord = {
          id: null,
          user_id: userId,
          sub_materi_id: id,
          is_unlocked: true,
          is_completed: false,
          current_poin_index: 0,
          progress_percent: initialProgress,
          last_accessed_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      } else {
        progressRecord = newProgress;
      }
    } else {
      // Update last accessed time
      const { error: updateError } = await req.supabase
        .from("user_sub_materi_progress")
        .update({ last_accessed_at: new Date().toISOString() })
        .eq("id", progressRecord.id);

      if (updateError) {
        console.warn(
          "[Progress API] Failed to update last_accessed_at:",
          updateError
        );
      }
    }

    // Format response to match frontend requirements exactly
    const responseData = {
      id: progressRecord.id || `temp_${userId}_${id}`,
      user_id: userId,
      sub_materi_id: id,
      is_unlocked: progressRecord.is_unlocked ?? true,
      is_completed: progressRecord.is_completed ?? false,
      current_poin_index: progressRecord.current_poin_index ?? 0,
      progress_percent: progressRecord.progress_percent ?? 0,
      last_accessed_at:
        progressRecord.last_accessed_at || new Date().toISOString(),
      created_at: progressRecord.created_at || new Date().toISOString(),
      updated_at: progressRecord.updated_at || new Date().toISOString(),
    };

    console.log("[Progress API] Success, returning progress:", responseData.id);

    return success(
      res,
      "SUB_MATERI_PROGRESS_SUCCESS",
      "Progress berhasil diambil",
      responseData
    );
  } catch (error) {
    console.error("[Progress API] Unexpected error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
};

// POST /api/v1/progress/sub-materis/:id/complete - Menandai sub materi sebagai selesai
const completeSubMateri = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // IMPORTANT: Frontend has static sub-materi data (dummy data)
    // Backend only tracks completion, does NOT validate sub-materi existence
    // Frontend is responsible for calling this after all poins completed

    console.log("DEBUG: Completing sub-materi:", {
      userId,
      sub_materi_id: id,
    });

    // Frontend sends module_id in body (required for grouping)
    const { module_id } = req.body;

    if (!module_id) {
      return failure(
        res,
        "MISSING_MODULE_ID",
        "module_id is required in request body",
        400
      );
    }

    // Mark sub_materi as completed
    const { data: progress, error: progressError } = await req.supabase
      .from("user_sub_materi_progress_simple")
      .upsert(
        {
          user_id: userId,
          module_id: parseInt(module_id),
          sub_materi_id: id,
          is_completed: true,
          completed_at: new Date().toISOString(),
          progress_percentage: 100,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,sub_materi_id", // Specify unique constraint columns
        }
      )
      .select()
      .single();

    if (progressError) {
      console.error("DEBUG: Error completing sub-materi:", progressError);
      return failure(
        res,
        "PROGRESS_UPDATE_ERROR",
        "Gagal memperbarui progress",
        500,
        { details: progressError.message }
      );
    }

    console.log("DEBUG: Sub-materi completed successfully:", progress);

    // 🔥 CRITICAL: Recalculate module progress after sub-materi completion
    await recalculateModuleProgress(req.supabase, userId, parseInt(module_id));

    return success(
      res,
      "SUB_MATERI_COMPLETED",
      "Sub materi berhasil diselesaikan",
      progress
    );
  } catch (error) {
    console.error("Complete sub materi error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
};

module.exports = {
  completePoin,
  getModuleProgress,
  getUserModulesProgress,
  checkSubMateriAccess,
  updateSubMateriProgress,
  updateModuleProgress,
  getSubMateriProgress,
  completeSubMateri,
};
