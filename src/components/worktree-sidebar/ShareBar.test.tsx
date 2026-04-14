import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ShareBar } from './ShareBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

describe('ShareBar', () => {
  it('renders ngrok and LAN rows only for active sharing', () => {
    render(
      <ShareBar
        active
        urls={['https://192.168.1.8:3456']}
        ngrokUrl="https://demo.ngrok-free.app"
        password="secret12"
        ngrokLoading={false}
        connectedClients={[]}
        onToggleNgrok={vi.fn()}
        onStart={vi.fn()}
        onStop={vi.fn()}
        onUpdatePassword={vi.fn()}
        hasNgrokToken
      />
    );

    expect(screen.getByText('share.ngrokLabel')).toBeInTheDocument();
    expect(screen.getByText('share.lan')).toBeInTheDocument();
    expect(screen.queryByText('share.remoteLabel')).not.toBeInTheDocument();
    expect(screen.queryByText('share.wmsDisconnected')).not.toBeInTheDocument();
  });
});
