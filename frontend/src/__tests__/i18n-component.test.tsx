// The interface follows the language of the user: a component shows its text in
// Russian when the language of the user is Russian.
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/preact';
import { Rail } from '../components/Rail';
import { setLanguage } from '../i18n';

describe('the language of the interface', () => {
  afterEach(() => {
    setLanguage('en');
  });

  it('shows the rail in English', () => {
    setLanguage('en');
    render(<Rail section="explorer" onSelect={() => {}} theme="dark" onToggleTheme={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole('button', { name: 'Explorer' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
  });

  it('shows the rail in Russian', () => {
    setLanguage('ru');
    render(<Rail section="explorer" onSelect={() => {}} theme="dark" onToggleTheme={() => {}} onOpenSettings={() => {}} />);
    expect(screen.getByRole('button', { name: 'Обозреватель' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Настройки' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Explorer' })).toBeNull();
  });
});
