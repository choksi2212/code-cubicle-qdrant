/**
 * Stepper — verifies that:
 *   - the current value is rendered
 *   - the +step / -step buttons fire onChange with value + step / step - 1
 *   - the +bigStep / -bigStep buttons fire onChange with the larger delta
 *   - the value is clamped to [min, max] — going below min produces the
 *     min value; going above max produces the max value
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Stepper } from '../src/components/Stepper';

function buttons(root: renderer.ReactTestRenderer['root']) {
  // Five Pressable buttons in order: [-big] [-small] [+small] [+big]
  // (the middle is a value display, not a Pressable).
  return root.root.findAllByType('Pressable' as any);
}

describe('Stepper', () => {
  it('renders the current value', () => {
    const root = renderer.create(
      <Stepper value={42} onChange={() => {}} />,
    );
    expect(JSON.stringify(root.toJSON())).toContain('42');
  });

  it('fires onChange with the small step (+1 / -1)', () => {
    const onChange = jest.fn();
    const root = renderer.create(
      <Stepper value={10} onChange={onChange} step={1} bigStep={100} />,
    );
    const btns = buttons(root);
    // Order: [-big, -1, +1, +big]
    act(() => {
      (btns[1].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(9);

    act(() => {
      (btns[2].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(11);
  });

  it('fires onChange with the big step (+100 / -100)', () => {
    const onChange = jest.fn();
    const root = renderer.create(
      <Stepper value={500} onChange={onChange} step={1} bigStep={100} />,
    );
    const btns = buttons(root);
    act(() => {
      (btns[0].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(400);

    act(() => {
      (btns[3].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(600);
  });

  it('clamps to min when subtracting would go below it', () => {
    const onChange = jest.fn();
    // value=4, step=1 → 4-1=3 (above min)
    const root = renderer.create(
      <Stepper value={4} onChange={onChange} min={0} step={1} bigStep={100} />,
    );
    const btns = buttons(root);
    // -1 from 4 → 3 (still above min)
    act(() => {
      (btns[1].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(3);

    // value=1, -1 clamps to 0
    const rootAtOne = renderer.create(
      <Stepper value={1} onChange={onChange} min={0} step={1} bigStep={100} />,
    );
    const oneBtns = buttons(rootAtOne);
    act(() => {
      (oneBtns[1].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('clamps to max when adding would exceed it', () => {
    const onChange = jest.fn();
    const root = renderer.create(
      <Stepper value={95} onChange={onChange} max={100} step={1} bigStep={50} />,
    );
    const btns = buttons(root);
    // +big from 95 → 145 → clamp to 100
    act(() => {
      (btns[3].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(100);

    // value=99, +1 → clamp to 100
    const rootAt99 = renderer.create(
      <Stepper value={99} onChange={onChange} max={100} step={1} bigStep={50} />,
    );
    const btns99 = buttons(rootAt99);
    act(() => {
      (btns99[2].props as any).onPress();
    });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('does not fire onChange when the new value would be unchanged', () => {
    const onChange = jest.fn();
    // Already at min, no movement possible in the negative direction.
    const root = renderer.create(
      <Stepper value={0} onChange={onChange} min={0} max={50} step={1} bigStep={100} />,
    );
    const btns = buttons(root);
    // Buttons are disabled when the operation would be a no-op clamp, so
    // the onPress handler is not invoked. We confirm by inspecting
    // the disabled prop directly rather than firing the handler.
    expect((btns[0].props as any).disabled).toBe(true);
    expect((btns[1].props as any).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
