import { fireEvent, render, screen } from '@testing-library/react-native';
import { AmountStepper } from '@/components/base/AmountStepper';

it('increments and decrements', async () => {
  const onChange = jest.fn();
  await render(<AmountStepper value={3} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText('Increase amount'));
  expect(onChange).toHaveBeenCalledWith(4);
  await fireEvent.press(screen.getByLabelText('Decrease amount'));
  expect(onChange).toHaveBeenCalledWith(2);
});

it('decrement disabled at min', async () => {
  const onChange = jest.fn();
  await render(<AmountStepper value={1} onChange={onChange} />);
  await fireEvent.press(screen.getByLabelText('Decrease amount'));
  expect(onChange).not.toHaveBeenCalled();
});

it('renders label and value', async () => {
  await render(<AmountStepper value={8} onChange={jest.fn()} label="Amount in parent" />);
  expect(screen.getByText('Amount in parent')).toBeOnTheScreen();
  expect(screen.getByText('8')).toBeOnTheScreen();
});
