import { beforeEach, describe, expect, it, vi } from 'vitest';
import { headquartersArt, headquartersRoom } from '../../src/sim/headquarters';
import { PhaserWorldRenderer } from '../../src/client/render/PhaserWorldRenderer';

const mock = vi.hoisted(() => ({
  ready: false,
  boot: () => {},
  buildRoom: vi.fn(),
  destroy: vi.fn(),
  games: 0,
}));

vi.mock('../../src/client/render/RoomScene', () => ({
  RoomScene: class {
    sys = { isActive: () => mock.ready };
    buildRoom = mock.buildRoom;
    constructor(private onReady: () => void) {}
    create() {
      mock.ready = true;
      this.onReady();
    }
  },
}));

vi.mock('phaser', () => ({
  default: {
    AUTO: 0,
    Scale: { FIT: 1, CENTER_BOTH: 2 },
    Game: class {
      destroy = mock.destroy;
      constructor(config: { scene: Array<{ create(): void }> }) {
        mock.games++;
        mock.boot = () => config.scene[0]!.create();
      }
    },
  },
}));

describe('renderer boot lifecycle', () => {
  beforeEach(() => {
    mock.ready = false;
    mock.games = 0;
    vi.clearAllMocks();
  });

  it('waits for scene creation and renders a room requested before plugins exist', async () => {
    const renderer = new PhaserWorldRenderer();
    renderer.showHeadquarters(headquartersRoom, headquartersArt);
    const mounting = renderer.mount({} as HTMLElement);
    expect(renderer.mount({} as HTMLElement)).toBe(mounting);
    expect(mock.games).toBe(1);
    expect(mock.buildRoom).not.toHaveBeenCalled();
    mock.boot();
    await mounting;
    expect(mock.buildRoom).toHaveBeenCalledExactlyOnceWith(headquartersRoom, headquartersArt, { headquarters: true }, []);
    renderer.destroy();
    expect(mock.destroy).toHaveBeenCalledExactlyOnceWith(true);
  });
});
