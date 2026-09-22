import { useTranslation } from "react-i18next";
import RadioGroup from "./RadioGroup";
import { useUserPreference } from "../features/user-preference/hooks/useUserPreferenceQueries";

/**
 * どの部署の仕事として記録するかを選ばせる。
 *
 * 兼務の人にしか出さない。所属が1つならサーバが決めるので選ぶまでもなく、
 * 欄があるだけ手間が増える。どこにも属していなければ部署なしで作る。
 *
 * 審査・チェックリスト・プロンプトの3か所で同じ判断が要るので部品にした。
 * 別々に書くと、足し忘れた画面だけ兼務の人が作れなくなる（サーバが
 * 「どちらの部署か選べ」と断るのに、選ぶ欄が無い状態になる）
 */
export function useDepartmentChoice() {
  const { preference } = useUserPreference();
  const departments = preference?.departments ?? [];
  return {
    departments,
    /** 選ばせる必要があるか */
    mustChoose: departments.length > 1,
  };
}

interface DepartmentPickerProps {
  value: string;
  onChange: (value: string) => void;
  error?: string;
}

export default function DepartmentPicker({
  value,
  onChange,
  error,
}: DepartmentPickerProps) {
  const { t } = useTranslation();
  const { departments, mustChoose } = useDepartmentChoice();

  if (!mustChoose) {
    return null;
  }

  return (
    <div className="mb-4">
      <RadioGroup
        name="departmentId"
        label={t("review.department")}
        options={departments.map((value) => ({ value, label: value }))}
        value={value}
        onChange={onChange}
        inline
        error={error}
      />
      <p className="mt-1 text-sm text-aws-font-color-gray">
        {t("review.departmentHelp")}
      </p>
    </div>
  );
}
