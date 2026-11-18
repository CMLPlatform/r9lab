import { render, screen } from '@testing-library/react-native';
import { AppText } from '@/components/base/AppText';

it('renders body text by default', async () => {
  await render(<AppText>hello</AppText>);
  expect(screen.getByText('hello')).toBeOnTheScreen();
});

it('data variant uses tabular numerals styling', async () => {
  await render(<AppText variant="data">42 g</AppText>);
  const el = screen.getByText('42 g');
  expect(el.props.style).toEqual(
    expect.arrayContaining([expect.objectContaining({ fontVariant: ['tabular-nums'] })]),
  );
});

it('default color comes from the text-foreground class', async () => {
  await render(<AppText>plain</AppText>);
  expect(screen.getByText('plain').props.className).toContain('text-foreground');
});

it('caller color classes win over the default (tailwind-merge)', async () => {
  await render(<AppText className="text-primary">tinted</AppText>);
  const className = screen.getByText('tinted').props.className;
  expect(className).toContain('text-primary');
  expect(className).not.toContain('text-foreground');
});

it('body variant (default) is selectable — record content is documentation', async () => {
  await render(<AppText variant="body">record note</AppText>);
  expect(screen.getByText('record note').props.selectable).toBe(true);
});

it('data variant is selectable', async () => {
  await render(<AppText variant="data">42 g</AppText>);
  expect(screen.getByText('42 g').props.selectable).toBe(true);
});

it('display variant is not selectable', async () => {
  await render(<AppText variant="display">Heading</AppText>);
  expect(screen.getByText('Heading').props.selectable).not.toBe(true);
});

it('title variant is not selectable', async () => {
  await render(<AppText variant="title">Section title</AppText>);
  expect(screen.getByText('Section title').props.selectable).not.toBe(true);
});

it('label variant is not selectable', async () => {
  await render(<AppText variant="label">Field label</AppText>);
  expect(screen.getByText('Field label').props.selectable).not.toBe(true);
});

it('eyebrow variant uses label metrics, uppercase transform, and muted color', async () => {
  await render(<AppText variant="eyebrow">Section</AppText>);
  const el = screen.getByText('Section');
  expect(el.props.style).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fontSize: 13, lineHeight: 18, textTransform: 'uppercase' }),
    ]),
  );
  expect(el.props.className).toContain('text-muted-foreground');
});

it('eyebrow color is overridable via className (tailwind-merge)', async () => {
  await render(
    <AppText variant="eyebrow" className="text-primary">
      Section
    </AppText>,
  );
  const className = screen.getByText('Section').props.className;
  expect(className).toContain('text-primary');
  expect(className).not.toContain('text-muted-foreground');
});

it('defaults maxFontSizeMultiplier to the app-wide Dynamic Type cap', async () => {
  await render(<AppText>hello</AppText>);
  expect(screen.getByText('hello').props.maxFontSizeMultiplier).toBe(2);
});

it('maxFontSizeMultiplier is overridable per call', async () => {
  await render(<AppText maxFontSizeMultiplier={1.5}>hello</AppText>);
  expect(screen.getByText('hello').props.maxFontSizeMultiplier).toBe(1.5);
});
