import { act, renderHook } from '@testing-library/react-native';
import { useSectionNav } from '@/hooks/useSectionNav';

it('scrollTo uses registered position minus offset, clamped at 0', async () => {
  const scrollToY = jest.fn();
  const { result } = await renderHook(() => useSectionNav(scrollToY));
  await act(() => {
    result.current.registerSection('overview', 0);
    result.current.registerSection('physical', 400);
  });
  await act(() => result.current.scrollTo('physical'));
  expect(scrollToY).toHaveBeenCalledWith(392);
  await act(() => result.current.scrollTo('overview'));
  expect(scrollToY).toHaveBeenCalledWith(0);
});

it('scroll spy activates the last section above the threshold line', async () => {
  const { result } = await renderHook(() => useSectionNav(jest.fn()));
  await act(() => {
    result.current.registerSection('overview', 0);
    result.current.registerSection('components', 300);
    result.current.registerSection('physical', 700);
  });
  await act(() => result.current.onScrollSpy(0));
  expect(result.current.activeKey).toBe('overview');
  await act(() => result.current.onScrollSpy(320));
  expect(result.current.activeKey).toBe('components');
  await act(() => result.current.onScrollSpy(680));
  expect(result.current.activeKey).toBe('physical');
});

it('scrollTo for an unregistered key is a no-op', async () => {
  const scrollToY = jest.fn();
  const { result } = await renderHook(() => useSectionNav(scrollToY));
  await act(() => result.current.scrollTo('media'));
  expect(scrollToY).not.toHaveBeenCalled();
});

it('a jump asked for before the section laid out lands on every registration in the window', async () => {
  const scrollToY = jest.fn();
  const { result } = await renderHook(() => useSectionNav(scrollToY));
  await act(() => result.current.scrollTo('security'));
  expect(scrollToY).not.toHaveBeenCalled();
  await act(() => result.current.registerSection('security', 100));
  expect(scrollToY).toHaveBeenLastCalledWith(92);
  // The anchored wrapper re-registers with the settled offset.
  await act(() => result.current.registerSection('security', 340));
  expect(scrollToY).toHaveBeenLastCalledWith(332);
});

it('a late layout after the window does not pull the page back', async () => {
  const scrollToY = jest.fn();
  const { result } = await renderHook(() => useSectionNav(scrollToY));
  await act(() => result.current.scrollTo('security'));
  await act(() => jest.advanceTimersByTime(2000));
  await act(() => result.current.registerSection('security', 100));
  expect(scrollToY).not.toHaveBeenCalled();
});
