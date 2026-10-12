"use client";

import { MorphIcon } from "morphicons/react";
import { Mail, MessageCircle } from "lucide";
import { resolveImageUrl } from "@/lib/url";

interface AuthorCardProps {
  name: string;
  bio: string;
  avatar: string;
  loading?: boolean;
  socials: {
    github?: string;
    email?: string;
    telegram?: string;
    discord?: string;
  };
}

export default function AuthorCard({
  name,
  bio,
  avatar,
  loading = false,
  socials,
}: AuthorCardProps) {
  const avatarUrl = resolveImageUrl(avatar);

  return (
    <div className="side-card side-author">
      {loading ? (
        /* 骨架（内部替换，外层 .side-card 不变） */
        <div className="sk-author">
          <div className="sk-circle" />
          <div className="sk-line w-40" />
          <div className="sk-line w-90" />
          <div className="sk-line w-70" />
          <div className="sk-author-socials">
            <div className="sk-circle" />
            <div className="sk-circle" />
            <div className="sk-circle" />
          </div>
        </div>
      ) : (
        /* 真实内容 */
        <>
          <div className="side-author-avatar">
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={name}
                onError={(e) =>
                  ((e.target as HTMLImageElement).style.display = "none")
                }
              />
            ) : (
              name[0] || "博"
            )}
          </div>
          <h3 className="side-author-name">{name || "博主"}</h3>
          <p className="side-author-bio">
            {bio || "这个人很懒，什么都没写"}
          </p>
          <div className="side-author-socials">
            {socials.github && (
              <a
                className="side-author-social"
                href={socials.github}
                target="_blank"
                rel="noopener noreferrer"
                title="GitHub"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.27-.01-1.17-.02-2.12-3.2.69-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.35.95.1-.74.4-1.25.72-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 2.9-.39c.98 0 1.97.13 2.9.39 2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.35.78 1.05.78 2.12 0 1.53-.01 2.76-.01 3.14 0 .31.21.67.8.55A10.99 10.99 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z" />
                </svg>
              </a>
            )}
            {socials.email && (
              <a
                className="side-author-social"
                href={socials.email}
                title="Email"
              >
                <MorphIcon icon={Mail} size={14} />
              </a>
            )}
            {socials.telegram && (
              <a
                className="side-author-social"
                href={socials.telegram}
                target="_blank"
                rel="noopener noreferrer"
                title="Telegram"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M22 2 2 10.5l6 2.5L10 22l4-6 6 4 2-18z" />
                </svg>
              </a>
            )}
            {socials.discord && (
              <a
                className="side-author-social"
                href={socials.discord}
                target="_blank"
                rel="noopener noreferrer"
                title="Discord"
              >
                <MorphIcon icon={MessageCircle} size={14} />
              </a>
            )}
          </div>
        </>
      )}
    </div>
  );
}