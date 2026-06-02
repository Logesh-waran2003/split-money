-- Add category column to expenses
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('food','transport','rent','utilities','entertainment','shopping','health','travel','other'));

-- RLS: allow creator to update their expenses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'expense_creator_can_update'
  ) THEN
    CREATE POLICY "expense_creator_can_update" ON expenses
      FOR UPDATE USING (paid_by = auth.uid());
  END IF;
END $$;

-- RLS: allow creator to delete their expenses
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expenses' AND policyname = 'expense_creator_can_delete'
  ) THEN
    CREATE POLICY "expense_creator_can_delete" ON expenses
      FOR DELETE USING (paid_by = auth.uid());
  END IF;
END $$;

-- RLS: allow creator to delete splits for their expenses (needed for re-split on edit)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'expense_splits' AND policyname = 'expense_creator_can_delete_splits'
  ) THEN
    CREATE POLICY "expense_creator_can_delete_splits" ON expense_splits
      FOR DELETE USING (
        EXISTS (
          SELECT 1 FROM expenses e WHERE e.id = expense_splits.expense_id AND e.paid_by = auth.uid()
        )
      );
  END IF;
END $$;
