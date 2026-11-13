import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SelectField, TextAreaField } from './Field';
import { Switch } from './Switch';

describe('a text area', () => {
  it('is labelled, with its hint and error read out with it', () => {
    render(
      <TextAreaField
        label="Summary"
        hint="One line on the product's card"
        error="At most 160 characters"
        defaultValue=""
      />,
    );
    const box = screen.getByRole('textbox', { name: 'Summary' });

    expect(box).toHaveAccessibleDescription(
      "One line on the product's card At most 160 characters",
    );
    expect(box).toHaveAttribute('aria-invalid', 'true');
  });

  it('counts the characters, and stops at the limit', async () => {
    function Summary() {
      const [value, setValue] = useState('');
      return (
        <TextAreaField
          label="Summary"
          maxLength={10}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      );
    }
    const user = userEvent.setup();
    render(<Summary />);

    await user.type(screen.getByLabelText('Summary'), 'Soothing oil');

    expect(screen.getByLabelText('Summary')).toHaveValue('Soothing o');
    expect(screen.getByText('10/10')).toBeInTheDocument();
  });

  it('is valid without an error', () => {
    render(<TextAreaField label="Usage" defaultValue="" />);

    expect(screen.getByLabelText('Usage')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Usage')).not.toHaveAttribute(
      'aria-describedby',
    );
  });
});

describe('a choice from a list', () => {
  it('is the browser’s own select, labelled, with its error read out', async () => {
    const chosen = vi.fn();
    const user = userEvent.setup();
    render(
      <SelectField
        label="GST rate"
        error="Choose a GST rate"
        defaultValue=""
        onChange={(event) => chosen(event.target.value)}
      >
        <option value="">Not set</option>
        <option value="5">5%</option>
        <option value="18">18%</option>
      </SelectField>,
    );
    const select = screen.getByRole('combobox', { name: 'GST rate' });

    await user.selectOptions(select, '18');

    expect(chosen).toHaveBeenCalledWith('18');
    expect(select).toHaveAccessibleDescription('Choose a GST rate');
  });
});

describe('a switch', () => {
  function Visible({ disabled = false }: { disabled?: boolean }) {
    const [on, setOn] = useState(false);
    return (
      <Switch
        label="Customers see it"
        hint="Hidden categories keep their products hidden too"
        checked={on}
        onChange={setOn}
        disabled={disabled}
      />
    );
  }

  it('says whether it is on, and is named and described', () => {
    render(<Visible />);
    const toggle = screen.getByRole('switch', { name: 'Customers see it' });

    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(
      'Hidden categories keep their products hidden too',
    );
  });

  it('flips with a click, with Space and Enter, and from its label', async () => {
    const user = userEvent.setup();
    render(<Visible />);
    const toggle = screen.getByRole('switch', { name: 'Customers see it' });

    await user.click(toggle);
    expect(toggle).toBeChecked();

    await user.keyboard(' ');
    expect(toggle).not.toBeChecked();

    await user.keyboard('{Enter}');
    expect(toggle).toBeChecked();

    await user.click(screen.getByText('Customers see it'));
    expect(toggle).not.toBeChecked();
  });

  it('does nothing while disabled', async () => {
    const user = userEvent.setup();
    render(<Visible disabled />);
    const toggle = screen.getByRole('switch', { name: 'Customers see it' });

    await user.click(toggle);

    expect(toggle).not.toBeChecked();
    expect(toggle).toBeDisabled();
  });
});
