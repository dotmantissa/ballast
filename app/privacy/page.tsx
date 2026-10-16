import Link from "next/link";
import { Logo } from "@/components/logo";
import { ArrowLeft } from "lucide-react";
export const metadata = { title: "Privacy" };
export default function Privacy() {
  return (
    <main id="main" className="legal-page">
      <Link className="brand" href="/">
        <Logo />
        ballast.
      </Link>
      <h1>Keep the private things private.</h1>
      <p>
        Ballast uses Privy to authenticate your email. Privy processes your
        email and authentication session. The Ballast server verifies your
        session before preparing any account action.
      </p>
      <h2>What Ballast stores</h2>
      <p>
        The application stores your Privy user ID, email, public Studio account
        address, encrypted signing key, submission timestamps, transaction
        references, encrypted signed transaction payloads, attempt history and
        operation outcomes in a Neon database. Keys are encrypted with AES 256
        GCM using a server secret kept separately from the database. The server
        can decrypt keys to submit your requested actions. This is a custodial
        account.
      </p>
      <h2>What becomes public</h2>
      <p>
        Registered manifests, executor and operator addresses, evidence URLs,
        claim statements, findings, appeal records, coverage and capital
        activity are published to GenLayer Studio. Public blockchain records
        cannot be deleted by this application. Evidence URLs may expose
        information to validators and anyone reading the record. Remove personal
        information and credentials before submitting.
      </p>
      <h2>Browser storage</h2>
      <p>
        Privy manages authentication session storage. Ballast saves your light
        or dark theme preference in your browser. The application does not
        include advertising trackers or analytics. Your browser contacts Privy
        for authentication, this application for data and the public links you
        choose to open. Fonts are served with the application.
      </p>
      <h2>Retention and access</h2>
      <p>
        Account and operation records persist while the service runs. Public
        Studio data persists for the lifetime of the development network.
        Signing out ends your local authenticated session but does not delete
        saved records. No account deletion endpoint is provided in this
        experimental version. For a privacy request, open an issue in the
        project repository without publishing personal information.
      </p>
      <p>
        Do not use this experimental pool for sensitive or confidential
        incidents.
      </p>
      <Link className="back-link" href="/">
        <ArrowLeft size={16} />
        Back to Ballast
      </Link>
    </main>
  );
}
