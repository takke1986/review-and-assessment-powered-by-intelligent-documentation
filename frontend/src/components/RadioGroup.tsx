/**
 * ラジオグループコンポーネント
 */
import React from 'react';

interface RadioOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  error?: string;
  className?: string;
  inline?: boolean;
}

export default function RadioGroup({
  name,
  options,
  value,
  onChange,
  label,
  error,
  className = '',
  inline = false
}: RadioGroupProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  };

  return (
    <div className={className}>
      {label && (
        <label className="block text-sm font-medium text-aws-squid-ink-light mb-2">
          {label}
        </label>
      )}
      {/* 横並びと縦並びで指定を混ぜない。space-y-2 と space-y-0 を重ねると、
          生成される CSS では space-y-2 が後に来るので打ち消せず、2つ目以降が
          下にずれる。gap なら向きごとに独立して効く。
          flex-wrap があるのは、狭い画面で横にはみ出さないようにするため */}
      <div
        className={
          inline
            ? 'flex flex-wrap items-center gap-x-4 gap-y-2'
            : 'space-y-2'
        }
      >
        {options.map((option) => (
          <div key={option.value} className="flex items-center">
            <input
              id={`${name}-${option.value}`}
              name={name}
              type="radio"
              value={option.value}
              checked={value === option.value}
              onChange={handleChange}
              disabled={option.disabled}
              className="h-4 w-4 text-aws-sea-blue-light border-gray-300 focus:ring-aws-sea-blue-light/20"
            />
            <label
              htmlFor={`${name}-${option.value}`}
              className={`ml-2 block text-sm font-medium ${
                option.disabled ? 'text-gray-400' : 'text-aws-squid-ink-light'
              }`}
            >
              {option.label}
            </label>
          </div>
        ))}
      </div>
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
