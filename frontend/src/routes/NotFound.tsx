import { Link, useLocation } from "react-router-dom";

import { notFoundLabelsEn } from "./labels.en";
import { HOME_PATH } from "./paths";

export default function NotFound() {
  const location = useLocation();
  const labels = notFoundLabelsEn;

  return (
    <div className="empty-screen">
      <div className="empty-card">
        <div className="empty-kicker">{labels.kicker}</div>
        <h2>{labels.title}</h2>
        <p>
          {labels.bodyBefore} <code>{location.pathname}</code>. {labels.bodyAfter}
        </p>
        <Link className="btn btn-primary" to={HOME_PATH}>
          {labels.back}
        </Link>
      </div>
    </div>
  );
}
