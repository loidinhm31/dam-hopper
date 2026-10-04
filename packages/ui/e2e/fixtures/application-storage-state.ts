export interface StorageStateOptions {
  appOrigin: string;
  profileId: string;
  token: string;
  username: string;
}

export interface PlaywrightStorageState {
  cookies: Array<{
    name: string;
    value: string;
    domain: string;
    path: string;
    expires: number;
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
  }>;
  origins: Array<{
    origin: string;
    localStorage: Array<{
      name: string;
      value: string;
    }>;
  }>;
}

/**
 * Creates Playwright storageState matching DamHopper's production profile storage.
 * Seeds ONLY damhopper_server_profiles, damhopper_active_profile_id, and damhopper_profile_auth_v2_<id>.
 */
export function createBrowserStorageState(
  options: StorageStateOptions,
): PlaywrightStorageState {
  const profileRecord = {
    id: options.profileId,
    name: "E2E Fixture Profile",
    url: options.appOrigin,
    authType: "basic" as const,
    username: options.username,
    createdAt: Date.now(),
    autoConnect: true,
  };

  const authRecord = {
    version: 2 as const,
    serverUrl: options.appOrigin,
    authType: "basic" as const,
    token: options.token,
  };

  return {
    cookies: [],
    origins: [
      {
        origin: options.appOrigin,
        localStorage: [
          {
            name: "damhopper_server_profiles",
            value: JSON.stringify([profileRecord]),
          },
          {
            name: "damhopper_active_profile_id",
            value: options.profileId,
          },
          {
            name: `damhopper_profile_auth_v2_${options.profileId}`,
            value: JSON.stringify(authRecord),
          },
        ],
      },
    ],
  };
}
