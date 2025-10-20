const Joi = require("joi");
const { success, failure } = require("../utils/respond");
const multer = require("multer");
const path = require("path");

// Validation schema for updating own profile
const updateOwnProfileSchema = Joi.object({
  full_name: Joi.string().trim().min(2).max(100).optional().messages({
    "string.min": "Full name must be at least 2 characters long",
    "string.max": "Full name must not exceed 100 characters",
  }),
  phone: Joi.string()
    .trim()
    .pattern(/^(\+62[8-9][\d]{8,11}|0[8-9][\d]{8,11})$/)
    .required()
    .messages({
      "string.pattern.base":
        "Phone must start with 08 or +628 and be 10-13 digits. Example: 081234567890",
      "any.required": "Phone number is required",
    }),
  email: Joi.string().trim().email().optional().allow("", null).messages({
    "string.email": "Email format is invalid",
  }),
  address: Joi.string().trim().max(500).allow("", null).optional(),
  profil_url: Joi.string().trim().uri().allow("", null).optional(),
  date_of_birth: Joi.date().iso().max("now").allow(null).optional().messages({
    "date.max": "Date of birth cannot be in the future",
  }),
})
  .min(1)
  .messages({
    "object.min": "At least one field must be updated",
  });

// GET /api/pengguna/profile - get own profile
async function getMyProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "USER_UNAUTHORIZED", "Unauthorized", 401);
    }
    // Use per-request authenticated client if present (RLS owner access)
    const client = req.supabase; // anon or user client supplied via middleware/auth
    const adminClient = req.supabaseAdmin;

    const { data: profile, error } = await client
      .from("profiles")
      .select(
        "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
      )
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      return failure(
        res,
        "USER_PROFILE_FETCH_ERROR",
        "Failed to fetch profile",
        500,
        { details: error.message }
      );
    }
    if (!profile) {
      return failure(
        res,
        "USER_PROFILE_NOT_FOUND",
        "Profile belum tersedia. Gunakan PUT /api/pengguna/profile untuk membuat pertama kali.",
        404
      );
    }

    // Convert old public URLs to signed URLs automatically
    if (
      profile.profil_url &&
      profile.profil_url.includes("/object/public/foto_profil/")
    ) {
      try {
        console.log("🔄 Converting old public URL to signed URL...");

        // Extract file path from public URL
        const urlObj = new URL(profile.profil_url);
        const pathParts = urlObj.pathname.split("/");
        const bucketIndex = pathParts.findIndex(
          (part) => part === "foto_profil"
        );

        if (bucketIndex !== -1 && pathParts.length > bucketIndex + 1) {
          const filePath = pathParts.slice(bucketIndex + 1).join("/");

          // Generate signed URL (valid for 1 year)
          const { data: signedUrlData, error: signedUrlError } =
            await adminClient.storage
              .from("foto_profil")
              .createSignedUrl(filePath, 365 * 24 * 60 * 60);

          if (!signedUrlError && signedUrlData?.signedUrl) {
            console.log("✅ Signed URL generated, updating profile...");

            // Update profile with signed URL using adminClient to bypass RLS
            const { data: updatedProfile, error: updateError } =
              await adminClient
                .from("profiles")
                .update({ profil_url: signedUrlData.signedUrl })
                .eq("id", userId)
                .select(
                  "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
                )
                .maybeSingle();

            if (!updateError && updatedProfile) {
              console.log("✅ Profile updated with signed URL");
              profile.profil_url = updatedProfile.profil_url;
            } else if (updateError) {
              console.error(
                "⚠️ Failed to update profile with signed URL:",
                updateError.message
              );
            }
          }
        }
      } catch (conversionError) {
        console.error(
          "⚠️ Failed to convert public URL to signed URL:",
          conversionError.message
        );
        // Don't fail the request, just log and continue with public URL
      }
    }

    return success(
      res,
      "USER_PROFILE_FETCH_SUCCESS",
      "Profile fetched",
      profile
    );
  } catch (e) {
    console.error("getMyProfile error:", e);
    return failure(res, "USER_INTERNAL_ERROR", "Internal server error", 500, {
      details: e.message,
    });
  }
}

// PUT /api/pengguna/profile - update own profile
async function updateMyProfile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "USER_UNAUTHORIZED", "Unauthorized", 401);
    }

    const { value, error: valErr } = updateOwnProfileSchema.validate(
      req.body || {}
    );
    if (valErr) {
      return failure(
        res,
        "USER_PROFILE_VALIDATION_ERROR",
        valErr.details[0].message,
        422
      );
    }

    // Ensure profile exists first
    const client = req.supabase;
    const { data: existing, error: fetchErr } = await client
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();
    if (fetchErr) {
      return failure(
        res,
        "USER_PROFILE_FETCH_ERROR",
        "Failed to check existing profile",
        500,
        { details: fetchErr.message }
      );
    }
    // If profile doesn't exist yet, create it (Option A: upsert-on-PUT)
    if (!existing) {
      const now = new Date().toISOString();
      const baseFullName =
        value.full_name || req.user?.email?.split("@")[0] || "User";
      const insertPayload = {
        id: userId,
        full_name: baseFullName,
        phone: value.phone || "",
        email: value.email || req.user?.email,
        address: value.address || null,
        profil_url: value.profil_url || null,
        date_of_birth: value.date_of_birth || null,
        role: "pengguna", // enforce default role
        created_at: now,
        updated_at: now,
      };

      // If user also wants to change email on initial creation and it's different, update auth first
      let emailChangedInitial = false;
      if (value.email && value.email !== req.user?.email) {
        try {
          const userClient = req.authenticatedClient;
          if (!userClient) {
            return failure(
              res,
              "USER_CLIENT_MISSING",
              "Authenticated client missing for email update",
              500
            );
          }
          const { error: emailErr } = await userClient.auth.updateUser({
            email: value.email,
          });
          if (emailErr) {
            return failure(
              res,
              "USER_EMAIL_UPDATE_ERROR",
              emailErr.message,
              400
            );
          }
          emailChangedInitial = true;
        } catch (e) {
          return failure(res, "USER_EMAIL_UPDATE_EXCEPTION", e.message, 500);
        }
      }

      const { data: created, error: createErr } = await client
        .from("profiles")
        .insert(insertPayload)
        .select(
          "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
        )
        .single();
      if (createErr) {
        return failure(
          res,
          "USER_PROFILE_CREATE_ERROR",
          createErr.message,
          500
        );
      }
      return success(
        res,
        "USER_PROFILE_CREATE_SUCCESS",
        emailChangedInitial
          ? "Profile created & email updated (periksa konfirmasi jika diperlukan)"
          : "Profile created",
        created,
        201
      );
    }

    const updatePayload = { ...value, updated_at: new Date().toISOString() };
    // Never allow role modifications here
    delete updatePayload.role;

    // Handle email change (Supabase Auth) first if requested
    let emailChanged = false;
    if (value.email && value.email !== req.user.email) {
      try {
        // Use per-request authenticated client (must carry user token)
        const userClient = req.authenticatedClient;
        if (!userClient) {
          return failure(
            res,
            "USER_CLIENT_MISSING",
            "Authenticated client missing for email update",
            500
          );
        }
        const { error: emailErr, data: emailData } =
          await userClient.auth.updateUser({ email: value.email });
        if (emailErr) {
          return failure(res, "USER_EMAIL_UPDATE_ERROR", emailErr.message, 400);
        }
        emailChanged = true;
        // If Supabase requires confirmation, email may be pending; still proceed updating profile email for consistency.
      } catch (e) {
        return failure(res, "USER_EMAIL_UPDATE_EXCEPTION", e.message, 500);
      }
    }

    // Do not leave email inside updatePayload if undefined
    if (updatePayload.email === undefined) delete updatePayload.email;

    const { data: updated, error: updErr } = await client
      .from("profiles")
      .update(updatePayload)
      .eq("id", userId)
      .select(
        "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
      )
      .single();

    if (updErr) {
      return failure(res, "USER_PROFILE_UPDATE_ERROR", updErr.message, 500);
    }

    return success(
      res,
      "USER_PROFILE_UPDATE_SUCCESS",
      emailChanged
        ? "Profile & email updated (periksa konfirmasi email jika diperlukan)"
        : "Profile updated",
      updated
    );
  } catch (e) {
    console.error("updateMyProfile error:", e);
    return failure(res, "USER_INTERNAL_ERROR", "Internal server error", 500, {
      details: e.message,
    });
  }
}

// Multer configuration for profile photo upload
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept only image files
    const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only image files (JPEG, PNG, WebP) are allowed"), false);
    }
  },
});

// POST /api/v1/users/profile/upload-photo - Upload profile photo
async function uploadProfilePhoto(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "USER_UNAUTHORIZED", "Unauthorized", 401);
    }

    if (!req.file) {
      return failure(res, "FILE_MISSING", "No file uploaded", 400);
    }

    const client = req.supabase;
    const adminClient = req.supabaseAdmin;

    // Generate unique filename
    const fileExtension = path.extname(req.file.originalname);
    const filename = `${userId}-${Date.now()}${fileExtension}`;
    const filePath = `profile-photos/${filename}`;

    // Upload to Supabase Storage (foto_profil bucket)
    const { data: uploadData, error: uploadError } = await adminClient.storage
      .from("foto_profil")
      .upload(filePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false, // Don't overwrite existing files
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return failure(res, "UPLOAD_ERROR", uploadError.message, 500);
    }

    // Get signed URL for the uploaded file (valid for 1 year)
    // Signed URLs work regardless of bucket privacy settings
    const { data: signedUrlData, error: signedUrlError } =
      await adminClient.storage
        .from("foto_profil")
        .createSignedUrl(filePath, 365 * 24 * 60 * 60); // 1 year expiry

    if (signedUrlError || !signedUrlData) {
      console.error("Signed URL error:", signedUrlError);
      // Cleanup uploaded file if URL generation fails
      await adminClient.storage.from("foto_profil").remove([filePath]);
      return failure(
        res,
        "SIGNED_URL_ERROR",
        signedUrlError?.message || "Failed to generate signed URL",
        500
      );
    }

    const photoUrl = signedUrlData.signedUrl;

    console.log(
      "📸 Photo upload successful, updating profile with URL:",
      photoUrl
    );

    // Update user profile with new photo URL using adminClient to bypass RLS
    const { data: updatedProfile, error: updateError } = await adminClient
      .from("profiles")
      .update({
        profil_url: photoUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select(
        "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
      )
      .maybeSingle(); // Use maybeSingle instead of single to avoid error if no rows

    if (updateError) {
      console.error("❌ Profile update error:", updateError);
      // If profile update fails, try to delete the uploaded file
      await adminClient.storage.from("foto_profil").remove([filePath]);
      return failure(res, "PROFILE_UPDATE_ERROR", updateError.message, 500);
    }

    if (!updatedProfile) {
      console.error("❌ Profile not found for user:", userId);
      // If profile doesn't exist, try to delete the uploaded file
      await adminClient.storage.from("foto_profil").remove([filePath]);
      return failure(res, "PROFILE_NOT_FOUND", "Profile tidak ditemukan", 404);
    }

    return success(
      res,
      "PROFILE_PHOTO_UPLOAD_SUCCESS",
      "Foto profil berhasil diupload",
      {
        profile: updatedProfile,
        photo_url: photoUrl,
        filename: filename,
      }
    );
  } catch (error) {
    console.error("uploadProfilePhoto error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// DELETE /api/v1/users/profile/photo - Delete profile photo
async function deleteProfilePhoto(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "USER_UNAUTHORIZED", "Unauthorized", 401);
    }

    const client = req.supabase;
    const adminClient = req.supabaseAdmin;

    // Get current profile to find existing photo
    const { data: profile, error: fetchError } = await client
      .from("profiles")
      .select("profil_url")
      .eq("id", userId)
      .single();

    if (fetchError || !profile) {
      return failure(res, "PROFILE_NOT_FOUND", "Profile tidak ditemukan", 404);
    }

    // Extract filename from URL if photo exists
    let filePath = null;
    if (profile.profil_url) {
      try {
        const url = new URL(profile.profil_url);
        const pathParts = url.pathname.split("/");
        const bucketIndex = pathParts.findIndex(
          (part) => part === "foto_profil"
        );
        if (bucketIndex !== -1 && pathParts.length > bucketIndex + 1) {
          filePath = pathParts.slice(bucketIndex + 1).join("/");
        }
      } catch (e) {
        console.error("Error parsing photo URL:", e);
      }
    }

    // Update profile to remove photo URL
    const { data: updatedProfile, error: updateError } = await client
      .from("profiles")
      .update({
        profil_url: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId)
      .select(
        "id, full_name, phone, email, address, profil_url, date_of_birth, role, created_at, updated_at"
      )
      .single();

    if (updateError) {
      return failure(res, "PROFILE_UPDATE_ERROR", updateError.message, 500);
    }

    // Try to delete file from storage if path was found
    if (filePath) {
      try {
        const { error: deleteError } = await adminClient.storage
          .from("foto_profil")
          .remove([filePath]);

        if (deleteError) {
          console.error("Storage delete error:", deleteError);
          // Don't fail the request if storage delete fails
        }
      } catch (e) {
        console.error("Exception during file deletion:", e);
      }
    }

    return success(
      res,
      "PROFILE_PHOTO_DELETE_SUCCESS",
      "Foto profil berhasil dihapus",
      {
        profile: updatedProfile,
      }
    );
  } catch (error) {
    console.error("deleteProfilePhoto error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

// POST /api/v1/users/me/change-password - Change user password
async function changePassword(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return failure(res, "USER_UNAUTHORIZED", "Unauthorized", 401);
    }

    const { currentPassword, newPassword } = req.body;

    // Validation
    if (!currentPassword || !newPassword) {
      return failure(
        res,
        "VALIDATION_ERROR",
        "Current password and new password are required",
        400
      );
    }

    if (newPassword.length < 6) {
      return failure(
        res,
        "VALIDATION_ERROR",
        "New password must be at least 6 characters",
        400
      );
    }

    // Use authenticated client to update password
    const userClient = req.authenticatedClient;
    if (!userClient) {
      return failure(
        res,
        "USER_CLIENT_MISSING",
        "Authenticated client missing",
        500
      );
    }

    // Verify current password by attempting to sign in
    const { data: signInData, error: signInError } =
      await userClient.auth.signInWithPassword({
        email: req.user.email,
        password: currentPassword,
      });

    if (signInError) {
      return failure(
        res,
        "INVALID_CURRENT_PASSWORD",
        "Password saat ini salah",
        400
      );
    }

    // Update password
    const { error: updateError } = await userClient.auth.updateUser({
      password: newPassword,
    });

    if (updateError) {
      console.error("Password update error:", updateError);
      return failure(
        res,
        "PASSWORD_UPDATE_ERROR",
        updateError.message || "Gagal mengubah password",
        500
      );
    }

    return success(
      res,
      "PASSWORD_CHANGE_SUCCESS",
      "Password berhasil diubah",
      null
    );
  } catch (error) {
    console.error("changePassword error:", error);
    return failure(res, "INTERNAL_ERROR", "Internal server error", 500, {
      details: error.message,
    });
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
  uploadProfilePhoto,
  deleteProfilePhoto,
  changePassword,
  upload, // Export multer instance for use in routes
};
