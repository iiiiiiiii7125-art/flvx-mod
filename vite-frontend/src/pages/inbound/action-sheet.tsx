import { Button } from "@/shadcn-bridge/heroui/button";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@/shadcn-bridge/heroui/modal";

const modalBase =
  "!w-[calc(100%-32px)] !mx-auto sm:!w-full rounded-2xl overflow-hidden";

export interface SheetAction {
  key: string;
  label: string;
  color?: "primary" | "secondary" | "success" | "warning" | "danger";
  disabled?: boolean;
  onPress: () => void;
}

/** A small menu of actions for one item, opened by tapping it. */
export function ActionSheet({
  isOpen,
  title,
  subtitle,
  children,
  actions,
  onClose,
}: {
  isOpen: boolean;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
  actions: SheetAction[];
  onClose: () => void;
}) {
  return (
    <Modal
      backdrop="blur"
      classNames={{ base: modalBase }}
      isOpen={isOpen}
      placement="center"
      size="md"
      onOpenChange={(open) => !open && onClose()}
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <h2 className="text-lg font-bold break-all">{title}</h2>
          {subtitle && (
            <div className="text-small font-normal text-default-500">
              {subtitle}
            </div>
          )}
        </ModalHeader>
        <ModalBody className="pb-6">
          {children}
          <div className="grid grid-cols-3 gap-2">
            {actions.map((a) => (
              <Button
                key={a.key}
                className="w-full min-w-0 px-1"
                color={a.color}
                isDisabled={a.disabled}
                variant="flat"
                onPress={() => {
                  onClose();
                  a.onPress();
                }}
              >
                {a.label}
              </Button>
            ))}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
