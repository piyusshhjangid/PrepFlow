import { Card, LinkButton } from '../components/ui';

export function NotFoundPage() {
  return (
    <Card title="Page not found">
      <p className="mb-4 text-sm text-slate-600">
        That page doesn’t exist. You can start from the beginning.
      </p>
      <LinkButton to="/">Go to the start</LinkButton>
    </Card>
  );
}
