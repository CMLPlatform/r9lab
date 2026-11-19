import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react-native';
import { AuthFormError } from '@/components/auth/AuthCardSections';
import { renderWithProviders } from '@/test-utils/index';

describe('AuthFormError', () => {
  it('is announced to screen readers as an alert', async () => {
    await renderWithProviders(<AuthFormError message="Invalid code" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Invalid code');
    expect(alert.props.accessibilityLiveRegion).toBe('polite');
  });

  it('renders nothing without a message', async () => {
    await renderWithProviders(<AuthFormError message={null} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
