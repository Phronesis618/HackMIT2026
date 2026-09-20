import { PlayerIdentitySchema, type PlayerIdentity } from '../../shared/contracts';
import { randomId } from '../../shared/ids';

export const IDENTITY_STORAGE_KEY = 'relay.identity.v1';

type IdentityStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function createIdentityPersistence(
  requestedTabName: string | null,
  stores: { readonly localStorage: IdentityStorage; readonly sessionStorage: IdentityStorage },
) {
  const trimmed = requestedTabName?.trim();
  const tabName = trimmed && /^[A-Za-z0-9 _-]{1,24}$/.test(trimmed) ? trimmed : null;
  const key = tabName ? `${IDENTITY_STORAGE_KEY}.tab.${tabName}` : IDENTITY_STORAGE_KEY;
  const storage = () => tabName ? stores.sessionStorage : stores.localStorage;
  const save = (identity: PlayerIdentity): void => {
    const parsed = PlayerIdentitySchema.safeParse(identity);
    if (!parsed.success) return;
    try {
      storage().setItem(key, JSON.stringify(parsed.data));
    } catch {
      // Storage can be blocked or full; the session still retains its identity.
    }
  };
  return {
    save,
    load(): PlayerIdentity {
      try {
        const raw = storage().getItem(key);
        if (raw) {
          const parsed = PlayerIdentitySchema.safeParse(JSON.parse(raw));
          if (parsed.success) return parsed.data;
        }
      } catch {
        // Fall back to an identity for this session.
      }
      const identity: PlayerIdentity = {
        id: randomId('player'),
        displayName: tabName ?? `Operative-${Math.floor(Math.random() * 900 + 100)}`,
        classId: 'bastion',
      };
      save(identity);
      return identity;
    },
  };
}
