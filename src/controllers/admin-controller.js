const { supabaseAnon, supabaseAdmin } = require("../lib/SupabaseClient");
const { paginate } = require("../utils/paginate");
const Joi = require("joi");
const { success, failure } = require("../utils/respond");

// Helpers for safe cross-table ops (handle optional tables like 'admins')
async function safeUpdateIfTableExists(client, table, matchCol, id, updates) {
  try {
    const { error } = await client.from(table).update(updates).eq(matchCol, id);
    if (error) {
      // Ignore missing relation error if table doesn't exist
      if (
        error.code === "42P01" ||
        /relation .* does not exist/i.test(error.message)
      ) {
        return { ignored: true };
      }
      return { error };
    }
    return { data: true };
  } catch (e) {
    return { error: e };
  }
}

async function safeDeleteIfTableExists(client, table, matchCol, id) {
  try {
    const { error } = await client.from(table).delete().eq(matchCol, id);
    if (error) {
      if (
        error.code === "42P01" ||
        /relation .* does not exist/i.test(error.message)
      ) {
        return { ignored: true };
      }
      return { error };
    }
    return { data: true };
  } catch (e) {
    return { error: e };
  }
}

// Validation schemas
const createUserSchema = Joi.object({
  email: Joi.string().email().required().messages({
    "string.email": "Email must be a valid email address",
    "any.required": "Email is required",
  }),
  password: Joi.string().min(6).required().messages({
    "string.min": "Password must be at least 6 characters long",
    "any.required": "Password is required",
  }),
  full_name: Joi.string().min(2).max(100).required().messages({
    "string.min": "Full name must be at least 2 characters long",
    "string.max": "Full name must not exceed 100 characters",
    "any.required": "Full name is required",
  }),
  phone: Joi.string()
    .pattern(/^(\+62[8-9][\d]{8,11}|0[8-9][\d]{8,11})$/)
    .optional()
    .allow("")
    .messages({
      "string.pattern.base":
        "Phone number must start with 08 and be 10-13 digits long (e.g., 08123456789)",
    }),
  address: Joi.string().trim().max(500).allow("", null).optional(),
  profil_url: Joi.string().trim().uri().allow("", null).optional(),
  date_of_birth: Joi.date().iso().max("now").allow(null).optional().messages({
    "date.max": "Tanggal lahir tidak boleh lebih dari hari ini",
  }),
  role: Joi.string().valid("pengguna", "admin").default("pengguna"),
});

const updateUserSchema = Joi.object({
  full_name: Joi.string().min(2).max(100).optional().messages({
    "string.min": "Full name must be at least 2 characters long",
    "string.max": "Full name must not exceed 100 characters",
  }),
  phone: Joi.string()
    .pattern(/^(\+62[8-9][\d]{8,11}|0[8-9][\d]{8,11})$/)
    .optional()
    .allow("")
    .messages({
      "string.pattern.base":
        "Phone number must start with 08 and be 10-13 digits long (e.g., 08123456789)",
    }),
  email: Joi.string().email().optional(),
  address: Joi.string().trim().max(500).allow("", null).optional(),
  profil_url: Joi.string().trim().uri().allow("", null).optional(),
  date_of_birth: Joi.date().iso().max("now").allow(null).optional().messages({
    "date.max": "Tanggal lahir tidak boleh lebih dari hari ini",
  }),
});

// GET /api/admin/users - Get all user profiles (admin only) with role-aware visibility rules
// Rules:
// - superadmin: melihat semua akun role pengguna & admin (TIDAK termasuk dirinya sendiri & tidak menampilkan superadmin lain jika ada)
// - admin biasa: hanya melihat akun role pengguna (tidak melihat admin lain maupun superadmin)
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, role: requestedRole, search } = req.query;
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;

    const callerRole =
      req.user?.profile?.role || req.profile?.role || "pengguna";
    const callerId = req.user?.id;

    // Tentukan role yang DIIZINKAN untuk ditampilkan berdasarkan role caller
    let allowedRoles = [];
    if (callerRole === "superadmin") {
      allowedRoles = ["pengguna", "admin"]; // superadmin tidak melihat superadmin termasuk dirinya
    } else {
      // role 'admin' (requireAdmin middleware sudah mencegah pengguna biasa)
      allowedRoles = ["pengguna"]; // admin hanya boleh lihat pengguna
    }

    let query = client
      .from("profiles")
      .select(
        "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at",
        {
          count: "exact",
        }
      )
      .in("role", allowedRoles);

    // Superadmin: sembunyikan akun dirinya sendiri agar tidak bisa menghapus / mengubah diri secara tidak sengaja
    if (callerRole === "superadmin" && callerId) {
      query = query.neq("id", callerId);
    }

    // Jika front-end meminta filter role spesifik, pastikan masih dalam allowedRoles
    if (requestedRole && allowedRoles.includes(requestedRole)) {
      query = query.eq("role", requestedRole);
    }

    // Pencarian (nama / email / phone)
    if (search) {
      const escaped = search.replace(/%/g, "");
      query = query.or(
        `full_name.ilike.%${escaped}%, email.ilike.%${escaped}%, phone.ilike.%${escaped}%`
      );
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) {
      console.error("Get users error:", error);
      return failure(
        res,
        "ADMIN_USERS_FETCH_ERROR",
        "Failed to fetch users",
        500,
        { details: error.message }
      );
    }

    // Enrich with auth metadata (last_sign_in_at, email_confirmed_at)
    let items = data || [];
    if (items && items.length > 0) {
      try {
        items = await Promise.all(
          items.map(async (u) => {
            try {
              const { data: authUserRes, error: authErr } =
                await supabaseAdmin.auth.admin.getUserById(u.id);
              if (!authErr && authUserRes?.user) {
                return {
                  ...u,
                  email_confirmed_at:
                    authUserRes.user.email_confirmed_at || null,
                  last_sign_in_at: authUserRes.user.last_sign_in_at || null,
                };
              }
            } catch (e) {
              // ignore per-user auth fetch errors
            }
            return { ...u, email_confirmed_at: null, last_sign_in_at: null };
          })
        );
      } catch (e) {
        console.warn(
          "[ADMIN] Failed to enrich users with auth metadata:",
          e?.message
        );
      }
    }

    const pagination = paginate(
      count || 0,
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    return success(
      res,
      "ADMIN_USERS_FETCH_SUCCESS",
      "Users retrieved successfully",
      {
        items,
        pagination,
        visibility: {
          caller_role: callerRole,
          allowed_roles: allowedRoles,
          excluded_self: callerRole === "superadmin",
        },
        filters: {
          role: requestedRole || undefined,
          search: search || undefined,
        },
      }
    );
  } catch (e) {
    console.error("GetAllUsers controller error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

// POST /api/admin/users - Create new user account (admin only)
const createUser = async (req, res) => {
  try {
    // Validate request body
    const { error: validationError, value } = createUserSchema.validate(
      req.body
    );
    if (validationError) {
      return failure(
        res,
        "ADMIN_USER_CREATE_VALIDATION_ERROR",
        validationError.details[0].message,
        422
      );
    }

    const {
      email,
      password,
      full_name,
      phone,
      address,
      profil_url,
      date_of_birth,
      role,
    } = value;

    // Only superadmin can create another admin
    const callerRole =
      req.user?.profile?.role || req.profile?.role || "pengguna";
    if (
      (role === "admin" || role === "superadmin") &&
      callerRole !== "superadmin"
    ) {
      return failure(
        res,
        "ADMIN_USER_CREATE_FORBIDDEN",
        "Only superadmin can create admin accounts",
        403
      );
    }

    console.log("[ADMIN] Creating user:", { email, role });

    // Create user with Supabase Admin (bypasses email confirmation)
    const { data: authData, error: authError } =
      await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          full_name,
          phone: phone || null,
          role,
        },
      });

    if (authError) {
      console.error("User creation error:", authError);

      if (authError.message.includes("already registered")) {
        return failure(
          res,
          "ADMIN_USER_EMAIL_EXISTS",
          "Email is already registered",
          400
        );
      }

      return failure(
        res,
        "ADMIN_USER_CREATE_ERROR",
        "Failed to create user",
        400,
        { details: authError.message }
      );
    }

    // Ensure profile exists: trigger may have inserted it; update if exists, otherwise insert
    const userId = authData.user.id;
    const now = new Date().toISOString();

    // Try to fetch existing profile
    const { data: existingProfile, error: profileFetchError } =
      await supabaseAdmin
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .single();

    let profileData;
    if (profileFetchError) {
      // If not found (PGRST116), insert new profile. Otherwise, treat as unexpected error
      if (profileFetchError.code === "PGRST116") {
        const { data: insertedProfile, error: profileInsertError } =
          await supabaseAdmin
            .from("profiles")
            .insert({
              id: userId,
              full_name,
              phone: phone || null,
              email: authData.user.email,
              address: address || null,
              profil_url: profil_url || null,
              date_of_birth: date_of_birth || null,
              role,
              created_at: now,
              updated_at: now,
            })
            .select()
            .single();
        if (profileInsertError) {
          // Fallback: retry without role column if schema lacks it (test env / migration lag)
          if (
            profileInsertError.code === "PGRST204" &&
            /'role' column/i.test(profileInsertError.message)
          ) {
            const { data: fallbackProfile, error: fbErr } = await supabaseAdmin
              .from("profiles")
              .insert({
                id: userId,
                full_name,
                phone: phone || null,
                email: authData.user.email,
                address: address || null,
                profil_url: profil_url || null,
                date_of_birth: date_of_birth || null,
                created_at: now,
                updated_at: now,
              })
              .select()
              .single();
            if (fbErr) {
              console.error("Profile insert fallback error:", fbErr);
              await supabaseAdmin.auth.admin.deleteUser(userId);
              return failure(
                res,
                "ADMIN_PROFILE_CREATE_ERROR",
                "Failed to create user profile",
                500,
                { details: fbErr.message }
              );
            }
            profileData = fallbackProfile;
          } else {
            console.error("Profile insert error:", profileInsertError);
            await supabaseAdmin.auth.admin.deleteUser(userId);
            return failure(
              res,
              "ADMIN_PROFILE_CREATE_ERROR",
              "Failed to create user profile",
              500,
              { details: profileInsertError.message }
            );
          }
        } else {
          profileData = insertedProfile;
        }
      } else {
        console.error("Profile fetch error:", profileFetchError);
        // Rollback auth user to maintain consistency
        await supabaseAdmin.auth.admin.deleteUser(userId);
        return failure(
          res,
          "ADMIN_PROFILE_VERIFY_ERROR",
          "Failed to verify user profile",
          500,
          { details: profileFetchError.message }
        );
      }
    } else {
      // Profile exists (likely from trigger) — update with provided fields to ensure consistency
      const { data: updatedProfile, error: profileUpdateError } =
        await supabaseAdmin
          .from("profiles")
          .update({
            full_name,
            phone: phone || null,
            email: authData.user.email,
            address: address || null,
            profil_url: profil_url || null,
            date_of_birth: date_of_birth || null,
            role,
            updated_at: now,
          })
          .eq("id", userId)
          .select()
          .single();
      if (profileUpdateError) {
        if (
          profileUpdateError.code === "PGRST204" &&
          /'role' column/i.test(profileUpdateError.message)
        ) {
          // Retry without role field
          const { data: fallbackUpdated, error: fbUpdErr } = await supabaseAdmin
            .from("profiles")
            .update({
              full_name,
              phone: phone || null,
              email: authData.user.email,
              address: address || null,
              profil_url: profil_url || null,
              date_of_birth: date_of_birth || null,
              updated_at: now,
            })
            .eq("id", userId)
            .select()
            .single();
          if (fbUpdErr) {
            console.error("Profile update fallback error:", fbUpdErr);
            return failure(
              res,
              "ADMIN_PROFILE_UPDATE_ERROR",
              "Failed to update user profile",
              500,
              { details: fbUpdErr.message }
            );
          }
          profileData = fallbackUpdated || existingProfile;
        } else {
          console.error("Profile update error:", profileUpdateError);
          return failure(
            res,
            "ADMIN_PROFILE_UPDATE_ERROR",
            "Failed to update user profile",
            500,
            { details: profileUpdateError.message }
          );
        }
      } else {
        profileData = updatedProfile || existingProfile;
      }
    }

    try {
      const normalizedRole = role === "admin" ? "admin" : null;
      if (normalizedRole) {
        const { error: metaErr } =
          await supabaseAdmin.auth.admin.updateUserById(userId, {
            app_metadata: { role: normalizedRole },
          });
        if (metaErr)
          console.warn(
            "[ADMIN] app_metadata.role sync failed:",
            metaErr.message
          );
      }
    } catch (e) {
      console.warn("[ADMIN] app_metadata.role sync exception:", e.message);
    }

    return success(
      res,
      "ADMIN_USER_CREATE_SUCCESS",
      "User created successfully",
      {
        id: authData.user.id,
        email: authData.user.email,
        email_confirmed_at: authData.user.email_confirmed_at,
        profile: profileData,
      },
      201
    );
  } catch (e) {
    console.error("Create user error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500, {
      details: e.message,
    });
  }
};

// GET /api/admin/users/:id - Get user by ID (admin only)
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get user profile
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;
    const { data: profileData, error: profileError } = await client
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (profileError) {
      if (profileError.code === "PGRST116") {
        return failure(res, "ADMIN_USER_NOT_FOUND", "User not found", 404);
      }
      return failure(
        res,
        "ADMIN_USER_FETCH_ERROR",
        "Failed to fetch user",
        500,
        { details: profileError.message }
      );
    }

    // Get auth user details (requires admin privileges)
    const { data: authUser, error: authError } =
      await supabaseAdmin.auth.admin.getUserById(id);

    if (authError)
      console.warn("[ADMIN] auth user fetch warn:", authError.message);

    return success(
      res,
      "ADMIN_USER_DETAIL_SUCCESS",
      "User retrieved successfully",
      {
        id: profileData.id,
        email: profileData.email,
        email_confirmed_at: authUser?.user?.email_confirmed_at || null,
        last_sign_in_at: authUser?.user?.last_sign_in_at || null,
        created_at: authUser?.user?.created_at || profileData.created_at,
        profile: profileData,
      }
    );
  } catch (e) {
    console.error("Get user by ID error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

// PUT /api/admin/users/:id - Update user profile (admin only)
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate request body
    const { error: validationError, value } = updateUserSchema.validate(
      req.body
    );
    if (validationError) {
      return failure(
        res,
        "ADMIN_USER_UPDATE_VALIDATION_ERROR",
        validationError.details[0].message,
        422
      );
    }

    const { full_name, phone, email, address, profil_url, date_of_birth } =
      value;

    console.log("Admin updating user:", {
      id,
      full_name,
      phone,
      email,
      address,
      profil_url,
      date_of_birth,
    });
    console.log("Admin user:", req.user.id, req.user.profile?.role);

    // Use service role for admin updates
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;

    // Check if user exists
    const { data: existingUser, error: fetchError } = await client
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError) {
      console.error("Fetch user error:", fetchError);
      if (fetchError.code === "PGRST116") {
        return failure(res, "ADMIN_USER_NOT_FOUND", "User not found", 404);
      }
      return failure(
        res,
        "ADMIN_USER_FETCH_ERROR",
        "Failed to fetch user",
        500,
        { details: fetchError.message }
      );
    }

    console.log("Existing user found:", existingUser);

    // Prepare update data
    const updateData = {};
    if (full_name !== undefined) updateData.full_name = full_name;
    if (phone !== undefined) updateData.phone = phone || null;
    if (email !== undefined) updateData.email = email;
    if (address !== undefined) updateData.address = address || null;
    if (profil_url !== undefined) updateData.profil_url = profil_url || null;
    if (date_of_birth !== undefined)
      updateData.date_of_birth = date_of_birth || null;

    // Add updated_at timestamp
    updateData.updated_at = new Date().toISOString();

    console.log("Update data:", updateData);

    // Update profile using service role client
    const { data: updatedProfile, error: updateError } = await client
      .from("profiles")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      return failure(
        res,
        "ADMIN_USER_UPDATE_ERROR",
        "Failed to update user",
        500,
        { details: updateError.message }
      );
    }

    return success(
      res,
      "ADMIN_USER_UPDATE_SUCCESS",
      "User updated successfully",
      updatedProfile
    );
  } catch (e) {
    console.error("Update user error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

// DELETE /api/admin/users/:id - Delete user account (admin only)
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const mode = (req.query.mode || req.body?.mode || "hard")
      .toString()
      .toLowerCase();

    // Prevent admin from deleting their own account
    if (id === req.user.id) {
      return failure(
        res,
        "ADMIN_USER_DELETE_FORBIDDEN",
        "Cannot delete your own account",
        400
      );
    }

    // Check if user exists
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;
    const { data: existingUser, error: fetchError } = await client
      .from("profiles")
      .select("id")
      .eq("id", id)
      .single();
    if (fetchError) {
      if (fetchError.code === "PGRST116")
        return failure(res, "ADMIN_USER_NOT_FOUND", "User not found", 404);
      return failure(
        res,
        "ADMIN_USER_FETCH_ERROR",
        "Failed to fetch user",
        500,
        { details: fetchError.message }
      );
    }

    if (mode === "soft") {
      // Soft delete: mark inactive and set deleted_at in profiles (+ optional admins)
      const now = new Date().toISOString();
      const { error: softErr } = await (supabaseAdmin || client)
        .from("profiles")
        .update({ is_active: false, deleted_at: now, updated_at: now })
        .eq("id", id);
      if (softErr) {
        return failure(
          res,
          "ADMIN_USER_SOFT_DELETE_ERROR",
          "Soft delete failed",
          500,
          { details: softErr.message }
        );
      }

      // Optional related table: admins (if exists), assume user_id FK
      await safeUpdateIfTableExists(
        supabaseAdmin || client,
        "admins",
        "user_id",
        id,
        { is_active: false, deleted_at: now }
      );

      return success(
        res,
        "ADMIN_USER_SOFT_DELETE_SUCCESS",
        "User soft-deleted successfully",
        { id, mode: "soft" }
      );
    }

    // Hard delete: clean optional related table then remove auth user (cascade)
    await safeDeleteIfTableExists(
      supabaseAdmin || client,
      "admins",
      "user_id",
      id
    );
    const { error: deleteError } = await (
      supabaseAdmin || client
    ).auth.admin.deleteUser(id);
    if (deleteError) {
      return failure(
        res,
        "ADMIN_USER_DELETE_ERROR",
        "Failed to delete user",
        500,
        { details: deleteError.message }
      );
    }
    return success(
      res,
      "ADMIN_USER_DELETE_SUCCESS",
      "User deleted successfully",
      { id, mode: "hard" }
    );
  } catch (e) {
    console.error("Delete user error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

// GET /api/admin/dashboard/stats - Get dashboard statistics (admin only)
const getDashboardStats = async (req, res) => {
  try {
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;
    const stats = {};

    // Collect counts sequentially (can optimize later with Promise.all)
    const { data: roles, error: rolesErr } = await client
      .from("profiles")
      .select("role", { count: "exact" });
    if (rolesErr) console.warn("[ADMIN] user stats warn:", rolesErr.message);

    // Guard against undefined roles to avoid TypeError on .length
    const roleList = Array.isArray(roles) ? roles : [];
    stats.users = {
      total: roleList.length,
      admin: roleList.filter((r) => r.role === "admin").length,
      regular: roleList.filter((r) => r.role === "pengguna").length,
    };

    const { count: materialsCount } = await client
      .from("sub_materis")
      .select("*", { count: "exact", head: true });
    const { count: publishedMaterialsCount } = await client
      .from("sub_materis")
      .select("*", { count: "exact", head: true })
      .eq("published", true);
    stats.materials = {
      total: materialsCount || 0,
      published: publishedMaterialsCount || 0,
      draft: (materialsCount || 0) - (publishedMaterialsCount || 0),
    };

    const { count: quizzesCount } = await client
      .from("materis_quizzes")
      .select("*", { count: "exact", head: true });
    const { count: quizSubmissionsCount } = await client
      .from("user_quiz_attempts")
      .select("*", { count: "exact", head: true });
    stats.quizzes = {
      total: quizzesCount || 0,
      submissions: quizSubmissionsCount || 0,
    };

    return success(
      res,
      "ADMIN_STATS_SUCCESS",
      "Dashboard statistics retrieved successfully",
      stats
    );
  } catch (e) {
    console.error("Admin stats error:", e);
    return failure(
      res,
      "ADMIN_STATS_ERROR",
      "Failed to retrieve statistics",
      500
    );
  }
};

// GET /api/admin/quiz-results - Get all quiz results (admin only)
const getAllQuizResults = async (req, res) => {
  try {
    const { page = 1, limit = 10, quiz_id, user_id } = req.query;
    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;

    let query = client
      .from("quiz_results")
      .select(
        `id, score, taken_at, profiles:user_id ( id, full_name ), quizzes:quiz_id ( id, title )`,
        { count: "exact" }
      );
    if (quiz_id) query = query.eq("quiz_id", quiz_id);
    if (user_id) query = query.eq("user_id", user_id);

    const { data, error, count } = await query
      .order("taken_at", { ascending: false })
      .range((page - 1) * limit, page * limit - 1);

    if (error) {
      console.error("Get quiz results error:", error);
      return failure(
        res,
        "ADMIN_QUIZ_RESULTS_FETCH_ERROR",
        "Failed to fetch quiz results",
        500,
        { details: error.message }
      );
    }

    const pagination = paginate(
      count || 0,
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    return success(
      res,
      "ADMIN_QUIZ_RESULTS_FETCH_SUCCESS",
      "Quiz results retrieved successfully",
      {
        items: data,
        pagination,
        filters: {
          quiz_id: quiz_id || undefined,
          user_id: user_id || undefined,
        },
      }
    );
  } catch (e) {
    console.error("Quiz results error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

// PUT /api/admin/users/:id/role - Update user role (admin only)
const updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body || {};

    if (!role || !["pengguna", "admin"].includes(role)) {
      return failure(
        res,
        "ADMIN_USER_ROLE_VALIDATION_ERROR",
        'Invalid role. Must be "pengguna" or "admin"',
        422
      );
    }

    const callerRole =
      req.user?.profile?.role || req.profile?.role || "pengguna";
    if (
      (role === "admin" || role === "superadmin") &&
      callerRole !== "superadmin"
    ) {
      return failure(
        res,
        "ADMIN_USER_ROLE_FORBIDDEN",
        "Only superadmin can assign admin roles",
        403
      );
    }

    const client = supabaseAdmin || req.authenticatedClient || supabaseAnon;
    const { data: existingUser, error: fetchError } = await client
      .from("profiles")
      .select("id, role")
      .eq("id", id)
      .single();

    if (fetchError || !existingUser) {
      return failure(res, "ADMIN_USER_NOT_FOUND", "User not found", 404);
    }

    if (id === req.user.id) {
      return failure(
        res,
        "ADMIN_USER_ROLE_SELF_FORBIDDEN",
        "Cannot change your own role",
        400
      );
    }

    const { data, error: updateError } = await client
      .from("profiles")
      .update({ role })
      .eq("id", id)
      .select()
      .single();

    if (updateError) {
      console.error("Update user role error:", updateError);
      return failure(
        res,
        "ADMIN_USER_ROLE_UPDATE_ERROR",
        "Failed to update user role",
        500,
        { details: updateError.message }
      );
    }

    try {
      const normalizedRole = role === "admin" ? "admin" : null;
      const payload = normalizedRole
        ? { app_metadata: { role: normalizedRole } }
        : { app_metadata: { role: null } };
      const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(
        id,
        payload
      );
      if (updErr)
        console.warn("[ADMIN] app_metadata.role update warn:", updErr.message);
    } catch (e) {
      console.warn("[ADMIN] app_metadata.role update exception:", e.message);
    }

    return success(
      res,
      "ADMIN_USER_ROLE_UPDATE_SUCCESS",
      "User role updated successfully",
      data
    );
  } catch (e) {
    console.error("Admin controller error:", e);
    return failure(res, "ADMIN_INTERNAL_ERROR", "Internal server error", 500);
  }
};

module.exports = {
  getAllUsers,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  getDashboardStats,
  getAllQuizResults,
  updateUserRole,
  inviteAdmin: createUser,
  getSystemStats: getDashboardStats,
};
