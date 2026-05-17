import { Modal as AntModal } from "antd";
import type { ReactNode } from "react";

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <AntModal open={open} title={title} onCancel={onClose} footer={null} destroyOnHidden>
      {children}
    </AntModal>
  );
}
