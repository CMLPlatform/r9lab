import { afterEach, expect, test as it, jest } from '@jest/globals';
import { fireEvent, screen } from '@testing-library/react-native';
import { AccessibilityInfo, StyleSheet } from 'react-native';
import { SaveBar } from '@/components/product/detail/SaveBar';
import { getImageUploadProgress } from '@/services/api/saving';
import {
  mockPlatform,
  queryAllHostsByType,
  renderWithProviders,
  restorePlatform,
} from '@/test-utils/index';

jest.mock('@/services/api/saving', () => ({
  getImageUploadProgress: jest.fn(() => null),
  subscribeToImageUploadProgress: jest.fn(() => () => {}),
}));

afterEach(() => {
  jest.mocked(getImageUploadProgress).mockReturnValue(null);
});

it('floats at the bottom right at every width, clearing the tab bar and wrapping its content', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={60}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={12}
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );

  const style = StyleSheet.flatten(screen.getByTestId('save-bar-dock').props.style);
  expect(style).toEqual(
    expect.objectContaining({ position: 'absolute', right: 24, left: 16, bottom: 84 }),
  );
  expect(StyleSheet.flatten(screen.getByTestId('save-bar-row').props.style)).toEqual(
    expect.objectContaining({ flexWrap: 'wrap' }),
  );
});

it('save bar shows error count and routes to the first error', async () => {
  const onErrorSummaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={3}
      onErrorSummaryPress={onErrorSummaryPress}
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByRole('button', { name: '3 fields need attention' }));
  expect(onErrorSummaryPress).toHaveBeenCalled();
  // The summary also lands in the polite status region, so it is heard when it appears.
  expect(screen.getByTestId('save-bar-status')).toHaveTextContent('3 fields need attention');
});

it('read mode renders a single Edit action', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode={false}
      isDirty={false}
      isSaving={false}
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByText('Edit product')).toBeTruthy();
});

it('not owned by me renders nothing', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode={false}
      isDirty={false}
      isSaving={false}
      isPaused={false}
      validationValid
      canModerate={false}
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.queryByText('Edit product')).toBeNull();
});

it('dirty edits with invalid validation and no error count block the save press', async () => {
  const onPrimaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      validationError="Name is required"
      onPrimaryPress={onPrimaryPress}
      canModerate
    />,
  );
  expect(screen.getByText('Name is required')).toBeTruthy();
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
});

it('needsAttention state routes the primary button press to the error summary, not save', async () => {
  const onPrimaryPress = jest.fn();
  const onErrorSummaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={2}
      onPrimaryPress={onPrimaryPress}
      onErrorSummaryPress={onErrorSummaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
  expect(onErrorSummaryPress).toHaveBeenCalledTimes(1);
});

// A paused save mutation shows a
// short "queued" label and drops the spinner instead of loading forever.
it('shows a queued label and no spinner while the save mutation is paused offline', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={true}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByText('Queued. Sends when online')).toBeTruthy();
  expect(queryAllHostsByType('ActivityIndicator')).toHaveLength(0);
});

// Photos upload sequentially after the entity PATCH lands, so a
// multi-photo save gets a progress count instead of sitting behind one mute spinner.
it('shows per-photo progress while photos upload mid-save', async () => {
  jest.mocked(getImageUploadProgress).mockReturnValue({ current: 2, total: 5 });
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  // Once on the button, once in the polite status region.
  expect(screen.getAllByText('Uploading 2 of 5…')).toHaveLength(2);
  expect(screen.getByTestId('upload-progress', { includeHiddenElements: true })).toBeTruthy();
});

it('ignores upload progress while the save is paused offline', async () => {
  jest.mocked(getImageUploadProgress).mockReturnValue({ current: 2, total: 5 });
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={true}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByText('Queued. Sends when online')).toBeTruthy();
  expect(screen.queryByText('Uploading 2 of 5…')).toBeNull();
  expect(screen.queryByTestId('upload-progress', { includeHiddenElements: true })).toBeNull();
});

it('shows the loading spinner while actually saving (not paused)', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByText('Save product')).toBeTruthy();
  expect(queryAllHostsByType('ActivityIndicator').length).toBeGreaterThan(0);
});

it('uses component labels for component pages', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="component"
      editMode={false}
      isDirty={false}
      isSaving={false}
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByText('Edit component')).toBeTruthy();
});

// ProductFabControls routes every editMode render straight to this component
// (`isMd || editMode`), so its edit-mode cases live here.
it('edit mode with nothing unsaved reads Done and stays pressable even while invalid', async () => {
  const onPrimaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty={false}
      isSaving={false}
      isPaused={false}
      validationValid={false}
      validationError="Type is required"
      onPrimaryPress={onPrimaryPress}
      canModerate
    />,
  );
  expect(screen.queryByText('Save product')).toBeNull();
  await fireEvent.press(screen.getByText('Done'));
  expect(onPrimaryPress).toHaveBeenCalledTimes(1);
});

it('valid dirty edits save on press', async () => {
  const onPrimaryPress = jest.fn();
  const onErrorSummaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid
      errorCount={0}
      onPrimaryPress={onPrimaryPress}
      onErrorSummaryPress={onErrorSummaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).toHaveBeenCalledTimes(1);
  expect(onErrorSummaryPress).not.toHaveBeenCalled();
});

// A second press mid-flight would fire the mutation twice. The spinner blocks
// this one; the queued case below has no spinner and relies on `disabled`.
it('blocks the press while a save is already in flight', async () => {
  const onPrimaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={false}
      validationValid
      onPrimaryPress={onPrimaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
});

// Queued offline drops the spinner, so the button reads as pressable; only
// `disabled` stops a second press from queueing the mutation twice.
it('blocks the press while the save sits queued offline', async () => {
  const onPrimaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={true}
      isPaused={true}
      validationValid
      onPrimaryPress={onPrimaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Queued. Sends when online'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
});

it('uses singular phrasing for a single error', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={1}
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );
  expect(screen.getByRole('button', { name: '1 field needs attention' })).toBeOnTheScreen();
});

// errorCount 0 is not "no errors"; it is an invalid form whose error summary
// has nothing to route to, so the press is blocked rather than redirected.
it('blocks the press when invalid with a zero error count', async () => {
  const onPrimaryPress = jest.fn();
  const onErrorSummaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={0}
      onPrimaryPress={onPrimaryPress}
      onErrorSummaryPress={onErrorSummaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
  expect(onErrorSummaryPress).not.toHaveBeenCalled();
});

// Blocked with no message to show: the button still has to refuse the press,
// and the bar must not render an empty error slot in its place.
it('blocks the press with no inline message when the form supplies no validation error', async () => {
  const onPrimaryPress = jest.fn();
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      onPrimaryPress={onPrimaryPress}
      canModerate
    />,
  );
  await fireEvent.press(screen.getByText('Save product'));
  expect(onPrimaryPress).not.toHaveBeenCalled();
  expect(screen.queryByText('Name is required')).toBeNull();
});

// On a 320px phone the inline error must shrink and wrap instead of pushing the button off screen.
it('lets the inline validation error shrink beside the button', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      validationError="Name is required"
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );
  expect(StyleSheet.flatten(screen.getByTestId('save-bar-status').props.style)).toEqual(
    expect.objectContaining({ flexShrink: 1 }),
  );
});

it('announces upload progress through a polite status region', async () => {
  jest.mocked(getImageUploadProgress).mockReturnValue({ current: 1, total: 3 });
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  const region = screen.getByTestId('save-bar-status');
  expect(region.props.accessibilityLiveRegion).toBe('polite');
  expect(region).toHaveTextContent('Uploading 1 of 3…');
});

it('announces upload progress on iOS, where live regions do nothing', async () => {
  mockPlatform('ios');
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  jest.mocked(getImageUploadProgress).mockReturnValue({ current: 1, total: 3 });
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(announce).toHaveBeenCalledWith('Uploading 1 of 3…');
  announce.mockRestore();
  restorePlatform();
});

it('announces the attention summary on iOS, where live regions do nothing', async () => {
  mockPlatform('ios');
  const announce = jest
    .spyOn(AccessibilityInfo, 'announceForAccessibility')
    .mockImplementation(() => {});
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      errorCount={2}
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );
  expect(announce).toHaveBeenCalledWith('2 fields need attention');
  announce.mockRestore();
  restorePlatform();
});

it('announces the validation message through the status region', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode
      isDirty
      isSaving={false}
      isPaused={false}
      validationValid={false}
      validationError="Name is required"
      onPrimaryPress={jest.fn()}
      canModerate
    />,
  );
  expect(screen.getByTestId('save-bar-status')).toHaveTextContent('Name is required');
});

it('keeps the status region mounted and empty when there is nothing to say', async () => {
  await renderWithProviders(
    <SaveBar
      bottomOffset={0}
      entityRole="product"
      editMode={false}
      isDirty={false}
      isSaving={false}
      isPaused={false}
      validationValid
      canModerate
      onPrimaryPress={jest.fn()}
    />,
  );
  expect(screen.getByTestId('save-bar-status')).toHaveTextContent('');
});
