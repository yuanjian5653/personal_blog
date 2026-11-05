import SearchBar from "@/components/home/SearchBar";
import ProfileCard from "@/components/home/ProfileCard";
import MusicCard from "@/components/home/MusicCard";
import TextCard from "@/components/home/TextCard";
import PhotosCard from "@/components/home/PhotosCard";
import FooterInfo from "@/components/home/FooterInfo";
import EssayCard from "@/components/home/EssayCard";
import ArticleCard from "@/components/home/ArticleCard";
import LifeMiniCard from "@/components/home/LifeMiniCard";
import EntryCards from "@/components/home/EntryCards";

export default function HomePage() {
  return (
    <div className="space-y-5 max-w-4xl mx-auto pt-2">
      {/* 1. 搜索框 */}
      <SearchBar />

      {/* 2. 个人信息 + 音乐卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-[3fr_2fr] gap-5 items-stretch">
        <ProfileCard />
        <MusicCard />
      </div>

      {/* 3. 文字动画卡片 */}
      <TextCard />

      {/* 4. 图片墙 + 文章/随笔 */}
      <div className="grid grid-cols-1 md:grid-cols-[2fr_3fr] gap-5">
        {/* 左：图片自动轮播（已有 3D 追踪） */}
        <PhotosCard />

        {/* 右：文章 + 随笔 */}
        <div className="flex flex-col gap-5">
          <ArticleCard />

          {/* 随笔卡片：内部固定高度 */}
          <div className="essay-life-row">
            <EssayCard />
            <LifeMiniCard />
          </div>
        </div>
      </div>

      {/* 5. 功能入口卡片（项目 / 工具 / 友链）
          样式与动效见 components/home/EntryCards.tsx + app/styles/entry-cards.css */}
      <EntryCards />

      {/* 6. 底部时间 + 网站信息 */}
      <FooterInfo />
    </div>
  );
}
