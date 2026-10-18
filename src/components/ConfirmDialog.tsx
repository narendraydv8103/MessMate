'use client';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText?: string;
  variant: 'green' | 'red' | 'amber';
  isSubmitting?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmText,
  cancelText = 'Cancel',
  variant,
  isSubmitting = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const btnClass =
    variant === 'green'
      ? 'btn-jaayenge'
      : variant === 'red'
      ? 'btn-nahi'
      : 'btn-informed';

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="modal-content">
        <h2 id="dialog-title" style={{ marginBottom: '12px', fontSize: '1.25rem' }}>
          {title}
        </h2>
        <p style={{ marginBottom: '24px', color: '#cbd5e1', fontSize: '0.95rem' }}>
          {message}
        </p>

        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
            style={{ flex: 1 }}
          >
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${btnClass}`}
            onClick={onConfirm}
            disabled={isSubmitting}
            style={{ flex: 1.2 }}
          >
            {isSubmitting ? 'Confirming...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}
