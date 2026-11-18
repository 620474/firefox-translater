local WidgetContainer = require("ui/widget/container/widgetcontainer")
local UIManager = require("ui/uimanager")
local InfoMessage = require("ui/widget/infomessage")
local ButtonDialog = require("ui/widget/buttondialog")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local TextViewer = require("ui/widget/textviewer")
local ConfirmBox = require("ui/widget/confirmbox")
local NetworkMgr = require("ui/network/manager")
local Trapper = require("ui/trapper")
local Device = require("device")
local JSON = require("json")
local Plugin = WidgetContainer:extend{ name="aiarticlereader", is_doc_only=false }
function Plugin:init()
    self.client = dofile(self.path .. "/client.lua")
    self.presets = dofile(self.path .. "/presets.lua")
    self.ui.menu:registerToMainMenu(self)
    if self.ui.highlight then
        self.ui.highlight:addToHighlightDialog("12_ai_article_reader", function(highlight)
            return { text="AI Article Reader", callback=function()
                highlight:highlightFromHoldPos()
                local selected = highlight.selected_text
                if not selected or not selected.text then return end
                local text = selected.text
                highlight:onClose(true)
                self:chooseAction(text)
            end }
        end)
    end
end
function Plugin:configure()
    local s = G_reader_settings:readSetting("aiar_settings", {})
    local dialog
    dialog = MultiInputDialog:new{
        title="AI Article Reader - настройки",
        fields={
            {description="Провайдер: gemini / deepseek / openai",text=s.provider or "gemini"},
            {description="API-ключ",text=s.key or "",text_type="password"},
            {description="ID модели",text=s.model or "gemini-2.5-flash"},
            {description="NestJS HTTPS (необязательно)",text=s.backend or ""},
            {description="Мой промпт",text=s.custom or self.presets.custom.task},
        },
        buttons={{
            {text="Отмена",callback=function() UIManager:close(dialog) end},
            {text="Сохранить",callback=function()
                local v=dialog:getFields()
                local settings={provider=v[1],key=v[2],model=v[3],backend=v[4],custom=v[5]}
                local ok,err=pcall(self.client.validate,settings)
                if not ok then UIManager:show(InfoMessage:new{text=tostring(err)});return end
                G_reader_settings:saveSetting("aiar_settings",settings)
                G_reader_settings:flush()
                UIManager:close(dialog)
            end},
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end
function Plugin:addToMainMenu(menu)
    menu.aiarticlereader={text="AI Article Reader",sorting_hint="more_tools",sub_item_table={
        {text="Настройки AI",callback=function() self:configure() end},
        {text="Сохранённые заметки",callback=function() self:showNotes() end},
    }}
end
function Plugin:chooseAction(selected)
    local rows={}
    local dialog
    for _,id in ipairs({"translate","explain","glossary","keypoints","custom"}) do
        local action=id
        rows[#rows+1]={{text=self.presets[action].label,callback=function()
            UIManager:close(dialog)
            UIManager:show(ConfirmBox:new{
                text="Отправить выделенный текст выбранному AI-провайдеру?",
                ok_callback=function() self:runAction(action,selected) end,
            })
        end}}
    end
    dialog=ButtonDialog:new{title="AI Article Reader",buttons=rows}
    UIManager:show(dialog)
end
local function post(url,headers,body)
    local http=require("socket.http")
    local ltn12=require("ltn12")
    local socketutil=require("socketutil")
    local sink,bytes={},0
    headers["Content-Length"]=tostring(#body)
    socketutil:set_timeout(20,90)
    local ok,code=pcall(function()
        local _,status=http.request{
            url=url,method="POST",headers=headers,source=ltn12.source.string(body),redirect=false,
            sink=function(chunk)
                if chunk then bytes=bytes+#chunk; if bytes>1000000 then return nil,"Response too large" end; sink[#sink+1]=chunk end
                return 1
            end,
        }
        return status
    end)
    socketutil:reset_timeout()
    if not ok or tonumber(code)~=200 then error("Ошибка AI-запроса: " .. tostring(tonumber(code) or "сеть")) end
    return table.concat(sink)
end
function Plugin:runAction(id,selected)
    local settings=G_reader_settings:readSetting("aiar_settings",{})
    local file=self.ui.document and self.ui.document.file or ""
    local title=file:gsub("\\", "/"):match("([^/]+)$") or ""
    local ok,prompt=pcall(self.client.buildPrompt,id,selected,title,settings.custom,self.presets,JSON)
    if not ok then UIManager:show(InfoMessage:new{text=tostring(prompt)});return end
    local valid=pcall(self.client.validate,settings)
    if not valid then self:configure();return end
    NetworkMgr:runWhenConnected(function()
        Trapper:wrap(function()
            local completed,result=Trapper:dismissableRunInSubprocess(function()
                local success,answer=pcall(self.client.generate,settings,prompt,{json=JSON,post=post})
                return {ok=success,text=tostring(answer)}
            end,"AI: обработка выделения…")
            if not completed or not result then return end
            if not result.ok then UIManager:show(InfoMessage:new{text=result.text});return end
            self:showAnswer(id,selected,title,result.text)
        end)
    end)
end
function Plugin:showAnswer(id,selected,title,answer)
    local buttons={{
        {text="В заметки",callback=function()
            local notes=G_reader_settings:readSetting("aiar_notes",{})
            table.insert(notes,1,{kind=id,selection=selected,title=title,answer=answer,created=os.time()})
            while #notes>80 do table.remove(notes) end
            G_reader_settings:saveSetting("aiar_notes",notes);G_reader_settings:flush()
            UIManager:show(InfoMessage:new{text="Заметка сохранена"})
        end},
    }}
    if Device:hasClipboard() then
        table.insert(buttons[1],{text="Копировать",callback=function() Device.input.setClipboardText(answer) end})
    end
    UIManager:show(TextViewer:new{title=self.presets[id].label,text=answer,buttons_table=buttons})
end
function Plugin:showNotes()
    local notes=G_reader_settings:readSetting("aiar_notes",{})
    local lines={}
    for _,note in ipairs(notes) do
        lines[#lines+1]=(note.title or "") .. "\n" .. (note.selection or "") .. "\n\n" .. note.answer
    end
    UIManager:show(TextViewer:new{title="AI - локальные заметки",text=#lines>0 and table.concat(lines,"\n\n----------------\n\n") or "Пока нет заметок"})
end
return Plugin
