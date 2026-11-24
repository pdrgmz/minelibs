import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmModal, PromptModal } from './ui';

describe('ConfirmModal', () => {
  it('muestra el diálogo y permite confirmar o cancelar', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <ConfirmModal
        open
        title="Eliminar"
        description="¿Seguro?"
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('¿Seguro?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cierra con Escape y con clic en el fondo', () => {
    const onClose = vi.fn();

    render(
      <ConfirmModal
        open
        title="Eliminar"
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={vi.fn()}
        onClose={onClose}
      />,
    );

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    const overlay = screen.getByRole('dialog').parentElement;
    expect(overlay).not.toBeNull();
    fireEvent.mouseDown(overlay!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('PromptModal', () => {
  it('envía el valor actual al confirmar', async () => {
    const onSubmit = vi.fn();

    render(
      <PromptModal
        open
        title="Nueva colección"
        label="Nombre"
        value="Gran granja"
        onChange={vi.fn()}
        onSubmit={onSubmit}
        onClose={vi.fn()}
        confirmLabel="Crear"
        cancelLabel="Cancelar"
      />,
    );

    await waitFor(() => expect(screen.getByLabelText('Nombre')).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: 'Crear' }));
    expect(onSubmit).toHaveBeenCalledWith('Gran granja');
  });
});
