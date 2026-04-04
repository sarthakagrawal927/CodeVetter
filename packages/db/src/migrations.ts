export type MigrationDefinition = {
  id: string;
  path: string;
};

export const CONTROL_PLANE_MIGRATIONS: MigrationDefinition[] = [
  {
    id: '0001_init',
    path: 'migrations/0001_init.sql'
  },
  {
    id: '0003_free_tier',
    path: 'migrations/0003_free_tier.sql'
  }
];
